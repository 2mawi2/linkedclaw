import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import type { Match, Profile } from "@/lib/types";

type MilestoneStatus = "pending" | "in_progress" | "completed" | "blocked";
const VALID_STATUSES: MilestoneStatus[] = ["pending", "in_progress", "completed", "blocked"];

/**
 * PATCH /api/deals/:matchId/milestones/:milestoneId - Update a milestone
 * Auth required. Must be a participant in the deal.
 *
 * Body: { agent_id, status?, title?, description?, due_date? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string; milestoneId: string }> },
) {
  const { matchId, milestoneId } = await params;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: {
    agent_id: string;
    status?: MilestoneStatus;
    title?: string;
    description?: string;
    due_date?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.agent_id) {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (body.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match API key" }, { status: 403 });
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Verify deal exists
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Verify participant
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

  // Verify milestone exists and belongs to this deal
  const milestoneResult = await db.execute({
    sql: "SELECT * FROM deal_milestones WHERE id = ? AND match_id = ?",
    args: [milestoneId, matchId],
  });
  if (milestoneResult.rows.length === 0) {
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  }

  // Build update
  const updates: string[] = [];
  const args: (string | null)[] = [];

  if (body.status) {
    updates.push("status = ?");
    args.push(body.status);
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    }
    updates.push("title = ?");
    args.push(body.title.trim());
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    args.push(body.description?.trim() ?? null);
  }
  if (body.due_date !== undefined) {
    updates.push("due_date = ?");
    args.push(body.due_date);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  args.push(milestoneId, matchId);

  await db.execute({
    sql: `UPDATE deal_milestones SET ${updates.join(", ")} WHERE id = ? AND match_id = ?`,
    args,
  });

  // Re-fetch updated milestone
  const updatedResult = await db.execute({
    sql: "SELECT * FROM deal_milestones WHERE id = ?",
    args: [milestoneId],
  });
  const updated = updatedResult.rows[0];

  // Notify counterpart
  const counterpart = body.agent_id === agentA ? agentB : agentA;
  if (counterpart && body.status) {
    await createNotification(db, {
      agent_id: counterpart,
      type: "milestone_updated",
      match_id: matchId,
      from_agent_id: body.agent_id,
      summary: `Milestone "${updated.title}" updated to ${body.status}`,
    });
  }

  // Check if all milestones are completed - auto-complete deal if so
  if (body.status === "completed") {
    const allMilestones = await db.execute({
      sql: "SELECT status FROM deal_milestones WHERE match_id = ?",
      args: [matchId],
    });
    const allCompleted = allMilestones.rows.every((m) => m.status === "completed");
    if (allCompleted && (match.status === "in_progress" || match.status === "approved")) {
      // Don't auto-complete the deal, but notify both parties that all milestones are done
      if (agentA) {
        await createNotification(db, {
          agent_id: agentA,
          type: "milestone_updated",
          match_id: matchId,
          summary:
            "All milestones completed! Use /api/deals/:matchId/complete to finalize the deal.",
        });
      }
      if (agentB) {
        await createNotification(db, {
          agent_id: agentB,
          type: "milestone_updated",
          match_id: matchId,
          summary:
            "All milestones completed! Use /api/deals/:matchId/complete to finalize the deal.",
        });
      }
    }
  }

  return NextResponse.json({
    milestone: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      due_date: updated.due_date,
      status: updated.status,
      position: updated.position,
      created_by: updated.created_by,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    },
  });
}
