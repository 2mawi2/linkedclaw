import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Project } from "@/lib/types";

/** POST /api/projects/:projectId/messages - Send a message to the project thread */
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
  if (!b.content || typeof b.content !== "string" || b.content.trim().length === 0) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
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

  // Check terminal states
  if (project.status === "completed" || project.status === "cancelled") {
    return NextResponse.json({ error: `Project is ${project.status}, no further messages allowed` }, { status: 400 });
  }

  // Verify agent is a participant (creator or role filler)
  const isCreator = project.creator_agent_id === b.agent_id;
  const roleResult = await db.execute({
    sql: "SELECT * FROM project_roles WHERE project_id = ? AND filled_by_agent_id = ?",
    args: [projectId, b.agent_id],
  });
  const isRoleFiller = roleResult.rows.length > 0;

  if (!isCreator && !isRoleFiller) {
    return NextResponse.json({ error: "Agent is not a participant in this project" }, { status: 403 });
  }

  let messageType = (b.message_type as string) ?? "discussion";
  if (messageType === "text") messageType = "discussion";
  if (!["discussion", "proposal", "system"].includes(messageType)) {
    return NextResponse.json({ error: "message_type must be 'discussion', 'proposal', or 'text'" }, { status: 400 });
  }

  // Insert message
  const result = await db.execute({
    sql: "INSERT INTO project_messages (project_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)",
    args: [projectId, b.agent_id, b.content.trim(), messageType],
  });

  // Update status if proposal
  if (messageType === "proposal" && (project.status === "open" || project.status === "negotiating")) {
    await db.execute({
      sql: "UPDATE projects SET status = 'proposed' WHERE id = ?",
      args: [projectId],
    });
  }

  // Notify all other participants
  const allRolesResult = await db.execute({
    sql: "SELECT filled_by_agent_id FROM project_roles WHERE project_id = ? AND filled_by_agent_id IS NOT NULL",
    args: [projectId],
  });
  const participants = new Set<string>();
  participants.add(project.creator_agent_id);
  for (const r of allRolesResult.rows) {
    participants.add(r.filled_by_agent_id as string);
  }
  participants.delete(b.agent_id as string); // Don't notify sender

  for (const pid of participants) {
    await createNotification(db, {
      agent_id: pid,
      type: "project_message",
      from_agent_id: b.agent_id as string,
      summary: `New message from ${b.agent_id} in project "${project.title}"`,
    });
  }

  return NextResponse.json({
    message_id: Number(result.lastInsertRowid),
    project_id: projectId,
    message_type: messageType,
    status: messageType === "proposal" ? "proposed" : project.status,
  });
}
