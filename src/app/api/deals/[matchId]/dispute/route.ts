import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Match, Profile, Dispute } from "@/lib/types";
import { randomUUID } from "crypto";

/** GET - Retrieve dispute for a deal */
export async function GET(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "dispute-get");
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await params;
  const db = await ensureDb();

  // Verify deal exists and user is participant
  const match = await getMatchIfParticipant(db, matchId, auth.agent_id, auth.user_id);
  if ("error" in match) {
    return NextResponse.json({ error: match.error }, { status: match.status });
  }

  const result = await db.execute({
    sql: "SELECT * FROM disputes WHERE match_id = ? ORDER BY created_at DESC",
    args: [matchId],
  });

  const disputes = result.rows.map((r) => ({
    id: r.id,
    match_id: r.match_id,
    filed_by_agent_id: r.filed_by_agent_id,
    reason: r.reason,
    status: r.status,
    resolution_note: r.resolution_note,
    resolved_by: r.resolved_by,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
  }));

  return NextResponse.json({ disputes });
}

/** POST - File a dispute on a deal */
export async function POST(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }
  if (!b.reason || typeof b.reason !== "string" || b.reason.trim().length === 0) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  if (b.reason.length > 2000) {
    return NextResponse.json({ error: "reason must be under 2000 characters" }, { status: 400 });
  }

  const db = await ensureDb();

  // Load match
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Only in_progress or approved deals can be disputed
  const DISPUTABLE_STATUSES = ["approved", "in_progress"];
  if (!DISPUTABLE_STATUSES.includes(match.status)) {
    return NextResponse.json(
      {
        error: `Cannot dispute a deal in '${match.status}' status. Disputable statuses: ${DISPUTABLE_STATUSES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Verify agent is participant
  const { profileA, profileB } = await getProfiles(db, match);
  const agentId = b.agent_id as string;
  if (profileA.agent_id !== agentId && profileB.agent_id !== agentId) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Check for existing open dispute
  const existing = await db.execute({
    sql: "SELECT id FROM disputes WHERE match_id = ? AND status = 'open'",
    args: [matchId],
  });
  if (existing.rows.length > 0) {
    return NextResponse.json(
      { error: "An open dispute already exists for this deal" },
      { status: 409 },
    );
  }

  const disputeId = randomUUID();
  const reason = (b.reason as string).trim();

  // Create dispute
  await db.execute({
    sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
    args: [disputeId, matchId, agentId, reason],
  });

  // Update deal status to disputed
  await db.execute({
    sql: "UPDATE matches SET status = 'disputed' WHERE id = ?",
    args: [matchId],
  });

  // Add system message
  await db.execute({
    sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)",
    args: [matchId, agentId, `Dispute filed by ${agentId}: ${reason}`, "system"],
  });

  // Notify counterpart
  const counterpartId = profileA.agent_id === agentId ? profileB.agent_id : profileA.agent_id;
  await createNotification(db, {
    agent_id: counterpartId,
    type: "deal_disputed",
    match_id: matchId,
    from_agent_id: agentId,
    summary: `${agentId} has filed a dispute: ${reason.slice(0, 100)}`,
  });

  return NextResponse.json({
    dispute: {
      id: disputeId,
      match_id: matchId,
      filed_by_agent_id: agentId,
      reason,
      status: "open",
    },
    message: "Dispute filed. Deal is now in disputed status.",
  });
}

// --- Helpers ---

async function getProfiles(db: Awaited<ReturnType<typeof ensureDb>>, match: Match) {
  const profileAResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [match.profile_a_id],
  });
  const profileA = profileAResult.rows[0] as unknown as Profile;
  const profileBResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [match.profile_b_id],
  });
  const profileB = profileBResult.rows[0] as unknown as Profile;
  return { profileA, profileB };
}

async function getMatchIfParticipant(
  db: Awaited<ReturnType<typeof ensureDb>>,
  matchId: string,
  agentId: string,
  userId?: string,
): Promise<{ error: string; status: number } | Match> {
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) return { error: "Deal not found", status: 404 };

  const { profileA, profileB } = await getProfiles(db, match);
  const isParticipant = profileA?.agent_id === agentId || profileB?.agent_id === agentId;

  let isOwner = false;
  if (!isParticipant && userId) {
    const ownerCheck = await db.execute({
      sql: "SELECT 1 FROM api_keys WHERE user_id = ? AND agent_id IN (?, ?)",
      args: [userId, profileA?.agent_id ?? "", profileB?.agent_id ?? ""],
    });
    isOwner = ownerCheck.rows.length > 0;
  }

  if (!isParticipant && !isOwner) {
    return { error: "Forbidden: you are not a participant in this deal", status: 403 };
  }

  return match;
}
