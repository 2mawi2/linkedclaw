import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Project } from "@/lib/types";

/** POST /api/projects/:projectId/approve - Approve/reject the project */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

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
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }
  if (typeof b.approved !== "boolean") {
    return NextResponse.json({ error: "approved (boolean) is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Get project
  const projectResult = await db.execute({
    sql: "SELECT * FROM projects WHERE id = ?",
    args: [projectId],
  });
  const project = projectResult.rows[0] as unknown as Project | undefined;

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.status === "completed" || project.status === "cancelled") {
    return NextResponse.json({ error: `Project is ${project.status}` }, { status: 400 });
  }

  // Verify agent is a participant
  const isCreator = project.creator_agent_id === b.agent_id;
  const roleResult = await db.execute({
    sql: "SELECT * FROM project_roles WHERE project_id = ? AND filled_by_agent_id = ?",
    args: [projectId, b.agent_id],
  });
  const isRoleFiller = roleResult.rows.length > 0;

  if (!isCreator && !isRoleFiller) {
    return NextResponse.json({ error: "Agent is not a participant in this project" }, { status: 403 });
  }

  // Record approval
  await db.execute({
    sql: `INSERT OR REPLACE INTO project_approvals (project_id, agent_id, approved) VALUES (?, ?, ?)`,
    args: [projectId, b.agent_id, b.approved ? 1 : 0],
  });

  // System message
  await db.execute({
    sql: "INSERT INTO project_messages (project_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'system')",
    args: [projectId, b.agent_id, `${b.agent_id} ${b.approved ? "approved" : "rejected"} the project`],
  });

  // Get all participants
  const allRolesResult = await db.execute({
    sql: "SELECT filled_by_agent_id FROM project_roles WHERE project_id = ? AND filled_by_agent_id IS NOT NULL",
    args: [projectId],
  });
  const participants = new Set<string>();
  participants.add(project.creator_agent_id);
  for (const r of allRolesResult.rows) {
    participants.add(r.filled_by_agent_id as string);
  }

  // If rejected, notify everyone
  if (!b.approved) {
    for (const pid of participants) {
      if (pid === b.agent_id) continue;
      await createNotification(db, {
        agent_id: pid,
        type: "project_cancelled",
        from_agent_id: b.agent_id as string,
        summary: `${b.agent_id} rejected project "${project.title}"`,
      });
    }
    // Cancel project on any rejection
    await db.execute({
      sql: "UPDATE projects SET status = 'cancelled' WHERE id = ?",
      args: [projectId],
    });
    return NextResponse.json({ project_id: projectId, status: "cancelled", reason: "rejected" });
  }

  // Check if all participants have approved
  const approvalsResult = await db.execute({
    sql: "SELECT agent_id FROM project_approvals WHERE project_id = ? AND approved = 1",
    args: [projectId],
  });
  const approvedAgents = new Set(approvalsResult.rows.map(r => r.agent_id as string));
  const allApproved = [...participants].every(p => approvedAgents.has(p));

  if (allApproved) {
    await db.execute({
      sql: "UPDATE projects SET status = 'approved' WHERE id = ?",
      args: [projectId],
    });

    // Notify all
    for (const pid of participants) {
      await createNotification(db, {
        agent_id: pid,
        type: "project_approved",
        from_agent_id: b.agent_id as string,
        summary: `Project "${project.title}" has been approved by all participants!`,
      });
    }

    return NextResponse.json({
      project_id: projectId,
      status: "approved",
      approvals: approvalsResult.rows.length,
      participants: participants.size,
      all_approved: true,
    });
  }

  // Notify others about this approval
  for (const pid of participants) {
    if (pid === b.agent_id) continue;
    await createNotification(db, {
      agent_id: pid,
      type: "project_proposed",
      from_agent_id: b.agent_id as string,
      summary: `${b.agent_id} approved project "${project.title}" (${approvedAgents.size}/${participants.size})`,
    });
  }

  return NextResponse.json({
    project_id: projectId,
    status: project.status,
    approvals: approvedAgents.size,
    participants: participants.size,
    all_approved: false,
    remaining: [...participants].filter(p => !approvedAgents.has(p)),
  });
}
