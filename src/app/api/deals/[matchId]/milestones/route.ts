import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Milestone, MilestoneStatus } from "@/lib/types";
import { randomUUID } from "crypto";

const VALID_STATUSES: MilestoneStatus[] = ["pending", "in_progress", "completed", "cancelled"];

/** Get the two agent_ids in a deal (from profiles). */
async function getDealParticipants(db: Awaited<ReturnType<typeof ensureDb>>, matchId: string): Promise<{ agentA: string; agentB: string; status: string } | null> {
  const result = await db.execute({
    sql: `SELECT m.status, pa.agent_id as agent_a, pb.agent_id as agent_b
          FROM matches m
          JOIN profiles pa ON pa.id = m.profile_a_id
          JOIN profiles pb ON pb.id = m.profile_b_id
          WHERE m.id = ?`,
    args: [matchId],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    agentA: row.agent_a as string,
    agentB: row.agent_b as string,
    status: row.status as string,
  };
}

/**
 * GET /api/deals/:matchId/milestones - List milestones for a deal
 * Auth required, must be a participant
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const db = await ensureDb();

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deal = await getDealParticipants(db, matchId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (auth.agent_id !== deal.agentA && auth.agent_id !== deal.agentB) {
    return NextResponse.json({ error: "Not a participant in this deal" }, { status: 403 });
  }

  const result = await db.execute({
    sql: "SELECT * FROM milestones WHERE match_id = ? ORDER BY order_index ASC, created_at ASC",
    args: [matchId],
  });

  const milestones = result.rows as unknown as Milestone[];
  const completed = milestones.filter(m => m.status === "completed").length;
  const total = milestones.filter(m => m.status !== "cancelled").length;

  return NextResponse.json({
    match_id: matchId,
    milestones: milestones.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.status,
      order_index: m.order_index,
      due_date: m.due_date,
      completed_at: m.completed_at,
      created_at: m.created_at,
    })),
    progress: {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
  });
}

/**
 * POST /api/deals/:matchId/milestones - Create a milestone
 * Auth required, must be a participant, deal must be approved/negotiating/proposed
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const { matchId } = await params;
  const db = await ensureDb();

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deal = await getDealParticipants(db, matchId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (auth.agent_id !== deal.agentA && auth.agent_id !== deal.agentB) {
    return NextResponse.json({ error: "Not a participant in this deal" }, { status: 403 });
  }
  if (!["negotiating", "proposed", "approved"].includes(deal.status)) {
    return NextResponse.json({ error: "Deal must be in negotiating, proposed, or approved status to add milestones" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400 });
  }
  if (body.due_date !== undefined && typeof body.due_date !== "string") {
    return NextResponse.json({ error: "due_date must be an ISO date string" }, { status: 400 });
  }
  if (body.order_index !== undefined && typeof body.order_index !== "number") {
    return NextResponse.json({ error: "order_index must be a number" }, { status: 400 });
  }

  const id = randomUUID();
  const orderIndex = typeof body.order_index === "number" ? body.order_index : 0;

  await db.execute({
    sql: `INSERT INTO milestones (id, match_id, title, description, order_index, due_date)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, matchId, body.title.trim(), body.description?.toString().trim() || null, orderIndex, body.due_date || null],
  });

  return NextResponse.json({
    id,
    match_id: matchId,
    title: body.title.trim(),
    description: body.description?.toString().trim() || null,
    status: "pending",
    order_index: orderIndex,
    due_date: body.due_date || null,
  }, { status: 201 });
}

/**
 * PATCH /api/deals/:matchId/milestones - Update a milestone status
 * Auth required, must be a participant
 * Body: { milestone_id, status, agent_id }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const { matchId } = await params;
  const db = await ensureDb();

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deal = await getDealParticipants(db, matchId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (auth.agent_id !== deal.agentA && auth.agent_id !== deal.agentB) {
    return NextResponse.json({ error: "Not a participant in this deal" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.milestone_id || typeof body.milestone_id !== "string") {
    return NextResponse.json({ error: "milestone_id is required" }, { status: 400 });
  }
  if (!body.status || !VALID_STATUSES.includes(body.status as MilestoneStatus)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  // Check milestone exists and belongs to this deal
  const existing = await db.execute({
    sql: "SELECT * FROM milestones WHERE id = ? AND match_id = ?",
    args: [body.milestone_id, matchId],
  });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  }

  const newStatus = body.status as MilestoneStatus;
  const completedAt = newStatus === "completed" ? new Date().toISOString() : null;

  await db.execute({
    sql: "UPDATE milestones SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?",
    args: [newStatus, completedAt, body.milestone_id],
  });

  // Add system message about milestone update
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type)
          VALUES (?, ?, ?, 'system')`,
    args: [
      matchId,
      auth.agent_id,
      `Milestone "${(existing.rows[0] as unknown as Milestone).title}" updated to ${newStatus}`,
    ],
  });

  return NextResponse.json({
    milestone_id: body.milestone_id,
    status: newStatus,
    completed_at: completedAt,
    message: `Milestone updated to ${newStatus}`,
  });
}
