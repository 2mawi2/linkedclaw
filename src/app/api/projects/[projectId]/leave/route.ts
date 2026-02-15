import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Project } from "@/lib/types";

/** POST /api/projects/:projectId/leave - Leave a project (vacate role) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
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
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
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
    return NextResponse.json(
      { error: `Project is ${project.status}, cannot leave` },
      { status: 400 },
    );
  }

  // Creator can't leave (they should cancel instead)
  if (project.creator_agent_id === b.agent_id) {
    return NextResponse.json(
      { error: "Project creator cannot leave. Use cancel instead." },
      { status: 400 },
    );
  }

  // Check if agent fills a role
  const roleResult = await db.execute({
    sql: "SELECT id, role_name FROM project_roles WHERE project_id = ? AND filled_by_agent_id = ?",
    args: [projectId, b.agent_id],
  });

  if (roleResult.rows.length === 0) {
    return NextResponse.json(
      { error: "Agent is not a participant in this project" },
      { status: 400 },
    );
  }

  const roleName = roleResult.rows[0].role_name as string;

  // Vacate the role
  await db.execute({
    sql: "UPDATE project_roles SET filled_by_agent_id = NULL, filled_by_profile_id = NULL WHERE project_id = ? AND filled_by_agent_id = ?",
    args: [projectId, b.agent_id],
  });

  // Remove approval
  await db.execute({
    sql: "DELETE FROM project_approvals WHERE project_id = ? AND agent_id = ?",
    args: [projectId, b.agent_id],
  });

  // Revert to open status if we were in negotiating/proposed
  if (
    project.status === "negotiating" ||
    project.status === "proposed" ||
    project.status === "approved"
  ) {
    await db.execute({
      sql: "UPDATE projects SET status = 'open' WHERE id = ?",
      args: [projectId],
    });
  }

  // System message
  await db.execute({
    sql: "INSERT INTO project_messages (project_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'system')",
    args: [projectId, b.agent_id, `${b.agent_id} left the project (role: ${roleName})`],
  });

  // Notify creator
  await createNotification(db, {
    agent_id: project.creator_agent_id,
    type: "project_member_left",
    from_agent_id: b.agent_id as string,
    summary: `${b.agent_id} left project "${project.title}" (role: ${roleName})`,
  });

  return NextResponse.json({
    project_id: projectId,
    agent_id: b.agent_id,
    role_vacated: roleName,
    status: "open",
  });
}
