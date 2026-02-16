import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import type { BountyStatus } from "@/lib/types";

const VALID_STATUSES: BountyStatus[] = ["open", "in_progress", "completed", "cancelled"];

/** GET /api/bounties/:id - get a single bounty (public) */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [id],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }

  const r = result.rows[0] as Record<string, unknown>;
  return NextResponse.json({
    id: r.id,
    creator_agent_id: r.creator_agent_id,
    title: r.title,
    description: r.description,
    category: r.category,
    skills: JSON.parse(String(r.skills || "[]")),
    budget_min: r.budget_min ?? null,
    budget_max: r.budget_max ?? null,
    currency: r.currency || "USD",
    deadline: r.deadline ?? null,
    status: r.status,
    assigned_agent_id: r.assigned_agent_id ?? null,
    match_id: r.match_id ?? null,
    created_at: r.created_at,
  });
}

/** PATCH /api/bounties/:id - update bounty status (auth required, owner only) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { agent_id, status } = body as Record<string, unknown>;
  if (!agent_id || typeof agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Verify ownership
  const existing = await db.execute({
    sql: "SELECT creator_agent_id FROM bounties WHERE id = ?",
    args: [id],
  });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }
  if (existing.rows[0].creator_agent_id !== agent_id) {
    return NextResponse.json({ error: "Only the bounty creator can update it" }, { status: 403 });
  }

  if (status && VALID_STATUSES.includes(status as BountyStatus)) {
    await db.execute({
      sql: "UPDATE bounties SET status = ? WHERE id = ?",
      args: [status as string, id],
    });
  }

  return NextResponse.json({ id, status: status || "unchanged" });
}
