import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Project } from "@/lib/types";

/** GET /api/projects/:projectId - Project details with roles, participants, messages */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, RATE_LIMITS.READ.prefix);
  if (rateLimited) return rateLimited;

  const { projectId } = await params;
  const db = await ensureDb();

  const projectResult = await db.execute({
    sql: "SELECT * FROM projects WHERE id = ?",
    args: [projectId],
  });
  const project = projectResult.rows[0] as unknown as Project | undefined;

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Get roles
  const rolesResult = await db.execute({
    sql: "SELECT * FROM project_roles WHERE project_id = ? ORDER BY created_at",
    args: [projectId],
  });
  const roles = rolesResult.rows.map(r => ({
    id: r.id,
    role_name: r.role_name,
    category: r.category,
    requirements: JSON.parse(r.requirements as string || "{}"),
    filled_by_agent_id: r.filled_by_agent_id,
    filled: !!r.filled_by_agent_id,
  }));

  // Get participants (creator + agents who filled roles)
  const participants = new Set<string>();
  participants.add(project.creator_agent_id);
  for (const role of roles) {
    if (role.filled_by_agent_id) participants.add(role.filled_by_agent_id as string);
  }

  // Get messages (last 50)
  const { searchParams } = new URL(req.url);
  const messageLimit = Math.min(parseInt(searchParams.get("message_limit") || "50"), 100);
  const messagesResult = await db.execute({
    sql: "SELECT * FROM project_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
    args: [projectId, messageLimit],
  });
  const messages = messagesResult.rows.reverse().map(m => ({
    id: m.id,
    sender_agent_id: m.sender_agent_id,
    content: m.content,
    message_type: m.message_type,
    created_at: m.created_at,
  }));

  // Get approvals
  const approvalsResult = await db.execute({
    sql: "SELECT * FROM project_approvals WHERE project_id = ?",
    args: [projectId],
  });
  const approvals = approvalsResult.rows.map(a => ({
    agent_id: a.agent_id,
    approved: !!a.approved,
    created_at: a.created_at,
  }));

  return NextResponse.json({
    id: project.id,
    creator_agent_id: project.creator_agent_id,
    title: project.title,
    description: project.description,
    status: project.status,
    max_participants: project.max_participants,
    roles,
    participants: Array.from(participants),
    participant_count: participants.size,
    roles_filled: roles.filter(r => r.filled).length,
    roles_total: roles.length,
    messages,
    approvals,
    created_at: project.created_at,
  });
}
