import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Match, Profile } from "@/lib/types";
import { randomUUID } from "crypto";

/**
 * GET /api/deals/:matchId/milestones - List milestones for a deal
 * Public endpoint.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rl = checkRateLimit(
    _req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "milestones-get",
  );
  if (rl) return rl;
  const { matchId } = await params;
  const db = await ensureDb();

  const matchResult = await db.execute({
    sql: "SELECT id FROM matches WHERE id = ?",
    args: [matchId],
  });
  if (matchResult.rows.length === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const milestonesResult = await db.execute({
    sql: "SELECT * FROM deal_milestones WHERE match_id = ? ORDER BY position ASC, created_at ASC",
    args: [matchId],
  });

  const milestones = milestonesResult.rows.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    due_date: m.due_date,
    status: m.status,
    position: m.position,
    created_by: m.created_by,
    created_at: m.created_at,
    updated_at: m.updated_at,
  }));

  const completed = milestones.filter((m) => m.status === "completed").length;

  return NextResponse.json({
    match_id: matchId,
    milestones,
    total: milestones.length,
    completed,
    progress: milestones.length > 0 ? Math.round((completed / milestones.length) * 100) : 0,
  });
}

/**
 * POST /api/deals/:matchId/milestones - Create milestones for a deal
 * Auth required. Must be a participant. Deal must be in approved/in_progress/negotiating/proposed status.
 *
 * Body: { agent_id, milestones: [{ title, description?, due_date?, position? }] }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rlw = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    "milestones-post",
  );
  if (rlw) return rlw;
  const { matchId } = await params;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: {
    agent_id: string;
    milestones: Array<{
      title: string;
      description?: string;
      due_date?: string;
      position?: number;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agent_id || !body.milestones) {
    return NextResponse.json({ error: "agent_id and milestones are required" }, { status: 400 });
  }

  if (body.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match API key" }, { status: 403 });
  }

  if (!Array.isArray(body.milestones) || body.milestones.length === 0) {
    return NextResponse.json({ error: "milestones must be a non-empty array" }, { status: 400 });
  }

  if (body.milestones.length > 20) {
    return NextResponse.json({ error: "Maximum 20 milestones per request" }, { status: 400 });
  }

  // Validate each milestone
  for (const m of body.milestones) {
    if (!m.title || typeof m.title !== "string" || m.title.trim().length === 0) {
      return NextResponse.json(
        { error: "Each milestone must have a non-empty title" },
        { status: 400 },
      );
    }
  }

  const db = await ensureDb();

  // Verify deal exists and user is a participant
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Check participant
  const profileAResult = await db.execute({
    sql: "SELECT agent_id FROM profiles WHERE id = ?",
    args: [match.profile_a_id],
  });
  const profileBResult = await db.execute({
    sql: "SELECT agent_id FROM profiles WHERE id = ?",
    args: [match.profile_b_id],
  });
  const agentA = (profileAResult.rows[0] as unknown as Profile)?.agent_id;
  const agentB = (profileBResult.rows[0] as unknown as Profile)?.agent_id;

  if (body.agent_id !== agentA && body.agent_id !== agentB) {
    return NextResponse.json({ error: "Not a participant in this deal" }, { status: 403 });
  }

  const allowedStatuses = ["negotiating", "proposed", "approved", "in_progress"];
  if (!allowedStatuses.includes(match.status)) {
    return NextResponse.json(
      { error: `Cannot add milestones to a deal with status '${match.status}'` },
      { status: 400 },
    );
  }

  // Get existing milestone count
  const existingResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM deal_milestones WHERE match_id = ?",
    args: [matchId],
  });
  const existingCount = Number((existingResult.rows[0] as unknown as { count: number }).count);
  if (existingCount + body.milestones.length > 20) {
    return NextResponse.json(
      {
        error: `Maximum 20 milestones per deal. Currently ${existingCount}, trying to add ${body.milestones.length}.`,
      },
      { status: 400 },
    );
  }

  const created = [];
  for (let i = 0; i < body.milestones.length; i++) {
    const m = body.milestones[i];
    const id = randomUUID();
    const position = m.position ?? existingCount + i;
    await db.execute({
      sql: `INSERT INTO deal_milestones (id, match_id, title, description, due_date, position, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        matchId,
        m.title.trim(),
        m.description?.trim() ?? null,
        m.due_date ?? null,
        position,
        body.agent_id,
      ],
    });
    created.push({ id, title: m.title.trim(), position, status: "pending" });
  }

  // Notify counterpart
  const counterpart = body.agent_id === agentA ? agentB : agentA;
  if (counterpart) {
    await createNotification(db, {
      agent_id: counterpart,
      type: "milestone_created",
      match_id: matchId,
      from_agent_id: body.agent_id,
      summary: `${body.agent_id} added ${created.length} milestone(s) to your deal`,
    });
  }

  return NextResponse.json({ milestones: created }, { status: 201 });
}
