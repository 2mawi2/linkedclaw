import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Agent-to-agent referrals - recommend another agent when you can't take a deal.
 *
 * POST /api/referrals - create a referral (auth required)
 * GET  /api/referrals - list referrals for the authenticated agent
 * GET  /api/referrals?agent_id=X - list referrals received by agent X (public)
 * PATCH /api/referrals/:id - accept/decline a referral (via query param id)
 */

/** GET /api/referrals - list referrals */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");
  const direction = searchParams.get("direction") || "received"; // received | sent | all

  // If no agent_id, require auth
  let targetAgentId = agentId;
  if (!targetAgentId) {
    const auth = await authenticateAny(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Authentication required or provide agent_id" },
        { status: 401 },
      );
    }
    targetAgentId = auth.agent_id;
  }

  const db = await ensureDb();

  let sql: string;
  let args: string[];

  if (direction === "sent") {
    sql = `SELECT r.id, r.referrer_agent_id, r.referred_agent_id, r.match_id, r.reason, r.status, r.created_at
           FROM referrals r WHERE r.referrer_agent_id = ? ORDER BY r.created_at DESC LIMIT 50`;
    args = [targetAgentId];
  } else if (direction === "all") {
    sql = `SELECT r.id, r.referrer_agent_id, r.referred_agent_id, r.match_id, r.reason, r.status, r.created_at
           FROM referrals r WHERE r.referrer_agent_id = ? OR r.referred_agent_id = ? ORDER BY r.created_at DESC LIMIT 50`;
    args = [targetAgentId, targetAgentId];
  } else {
    sql = `SELECT r.id, r.referrer_agent_id, r.referred_agent_id, r.match_id, r.reason, r.status, r.created_at
           FROM referrals r WHERE r.referred_agent_id = ? ORDER BY r.created_at DESC LIMIT 50`;
    args = [targetAgentId];
  }

  const result = await db.execute({ sql, args });

  const referrals = result.rows.map((row) => ({
    id: row.id,
    referrer_agent_id: row.referrer_agent_id,
    referred_agent_id: row.referred_agent_id,
    match_id: row.match_id,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
  }));

  return NextResponse.json({ referrals });
}

/** POST /api/referrals - create a referral */
export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: {
    referred_agent_id?: string;
    match_id?: string;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { referred_agent_id, match_id, reason } = body;

  if (
    !referred_agent_id ||
    typeof referred_agent_id !== "string" ||
    referred_agent_id.trim().length === 0
  ) {
    return NextResponse.json({ error: "referred_agent_id is required" }, { status: 400 });
  }

  if (referred_agent_id === auth.agent_id) {
    return NextResponse.json({ error: "Cannot refer yourself" }, { status: 400 });
  }

  const db = await ensureDb();

  // Verify the referred agent exists (has at least one API key)
  const agentCheck = await db.execute({
    sql: "SELECT agent_id FROM api_keys WHERE agent_id = ? LIMIT 1",
    args: [referred_agent_id],
  });
  if (agentCheck.rows.length === 0) {
    return NextResponse.json({ error: "Referred agent not found" }, { status: 404 });
  }

  // If match_id provided, verify it exists and referrer is part of it
  if (match_id) {
    const matchCheck = await db.execute({
      sql: `SELECT m.id FROM matches m
            JOIN profiles pa ON m.profile_a_id = pa.id
            JOIN profiles pb ON m.profile_b_id = pb.id
            WHERE m.id = ? AND (pa.agent_id = ? OR pb.agent_id = ?)`,
      args: [match_id, auth.agent_id, auth.agent_id],
    });
    if (matchCheck.rows.length === 0) {
      return NextResponse.json(
        { error: "Match not found or you are not part of it" },
        { status: 404 },
      );
    }
  }

  // Check for duplicate referral
  const dupeCheck = await db.execute({
    sql: `SELECT id FROM referrals
          WHERE referrer_agent_id = ? AND referred_agent_id = ? AND match_id ${match_id ? "= ?" : "IS NULL"}
          AND status = 'pending'`,
    args: match_id
      ? [auth.agent_id, referred_agent_id, match_id]
      : [auth.agent_id, referred_agent_id],
  });
  if (dupeCheck.rows.length > 0) {
    return NextResponse.json(
      { error: "Referral already exists", referral_id: dupeCheck.rows[0].id },
      { status: 409 },
    );
  }

  const id = `ref_${crypto.randomUUID().slice(0, 12)}`;

  await db.execute({
    sql: `INSERT INTO referrals (id, referrer_agent_id, referred_agent_id, match_id, reason)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, auth.agent_id, referred_agent_id, match_id || null, reason?.trim() || null],
  });

  // Create notification for the referred agent
  await db.execute({
    sql: `INSERT INTO notifications (agent_id, type, from_agent_id, match_id, summary)
          VALUES (?, 'referral', ?, ?, ?)`,
    args: [
      referred_agent_id,
      auth.agent_id,
      match_id || null,
      `${auth.agent_id} referred you${match_id ? " for a deal" : ""}${reason ? ": " + reason.trim() : ""}`,
    ],
  });

  return NextResponse.json({ referral_id: id }, { status: 201 });
}

/** PATCH /api/referrals - accept or decline a referral (pass id as query param) */
export async function PATCH(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const referralId = searchParams.get("id");
  if (!referralId) {
    return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.status || !["accepted", "declined"].includes(body.status)) {
    return NextResponse.json({ error: "status must be 'accepted' or 'declined'" }, { status: 400 });
  }

  const db = await ensureDb();

  // Verify the referral exists and belongs to the authenticated agent
  const referral = await db.execute({
    sql: "SELECT id, referred_agent_id, status FROM referrals WHERE id = ?",
    args: [referralId],
  });
  if (referral.rows.length === 0) {
    return NextResponse.json({ error: "Referral not found" }, { status: 404 });
  }
  if (referral.rows[0].referred_agent_id !== auth.agent_id) {
    return NextResponse.json(
      { error: "Only the referred agent can update this referral" },
      { status: 403 },
    );
  }
  if (referral.rows[0].status !== "pending") {
    return NextResponse.json({ error: "Referral already resolved" }, { status: 409 });
  }

  await db.execute({
    sql: "UPDATE referrals SET status = ? WHERE id = ?",
    args: [body.status, referralId],
  });

  return NextResponse.json({ ok: true, status: body.status });
}
