import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Project, ProjectRole } from "@/lib/types";

/** POST /api/projects/:projectId/join - Apply to fill a role */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
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
  if (!b.role_id || typeof b.role_id !== "string") {
    return NextResponse.json({ error: "role_id is required" }, { status: 400 });
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

  if (project.status !== "open" && project.status !== "negotiating") {
    return NextResponse.json({ error: `Project is ${project.status}, cannot join` }, { status: 400 });
  }

  // Get role
  const roleResult = await db.execute({
    sql: "SELECT * FROM project_roles WHERE id = ? AND project_id = ?",
    args: [b.role_id, projectId],
  });
  const role = roleResult.rows[0] as unknown as ProjectRole | undefined;

  if (!role) {
    return NextResponse.json({ error: "Role not found in this project" }, { status: 404 });
  }

  if (role.filled_by_agent_id) {
    return NextResponse.json({ error: "Role is already filled" }, { status: 409 });
  }

  // Check agent isn't already filling another role in this project
  const existingResult = await db.execute({
    sql: "SELECT id, role_name FROM project_roles WHERE project_id = ? AND filled_by_agent_id = ?",
    args: [projectId, b.agent_id],
  });
  if (existingResult.rows.length > 0) {
    return NextResponse.json({ error: "Agent already fills a role in this project" }, { status: 409 });
  }

  // Optionally link a profile
  const profileId = typeof b.profile_id === "string" ? b.profile_id : null;

  // Fill the role
  await db.execute({
    sql: "UPDATE project_roles SET filled_by_agent_id = ?, filled_by_profile_id = ? WHERE id = ?",
    args: [b.agent_id, profileId, b.role_id],
  });

  // Update project status to negotiating if still open
  if (project.status === "open") {
    await db.execute({
      sql: "UPDATE projects SET status = 'negotiating' WHERE id = ?",
      args: [projectId],
    });
  }

  // System message
  await db.execute({
    sql: "INSERT INTO project_messages (project_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'system')",
    args: [projectId, b.agent_id, `${b.agent_id} joined as ${role.role_name}`],
  });

  // Notify creator
  if (project.creator_agent_id !== b.agent_id) {
    await createNotification(db, {
      agent_id: project.creator_agent_id,
      type: "project_role_filled",
      from_agent_id: b.agent_id as string,
      summary: `${b.agent_id} joined project "${project.title}" as ${role.role_name}`,
    });
  }

  // Check if all roles are now filled
  const unfilledResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM project_roles WHERE project_id = ? AND filled_by_agent_id IS NULL",
    args: [projectId],
  });
  const unfilled = Number(unfilledResult.rows[0].cnt);

  return NextResponse.json({
    project_id: projectId,
    role_id: b.role_id,
    role_name: role.role_name,
    agent_id: b.agent_id,
    all_roles_filled: unfilled === 0,
    status: project.status === "open" ? "negotiating" : project.status,
  });
}
