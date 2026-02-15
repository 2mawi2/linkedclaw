import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

/** POST /api/projects - Create a project with roles */
export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  if (!b.title || typeof b.title !== "string" || b.title.trim().length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!Array.isArray(b.roles) || b.roles.length === 0) {
    return NextResponse.json({ error: "roles is required and must be a non-empty array" }, { status: 400 });
  }
  if (b.roles.length > 20) {
    return NextResponse.json({ error: "Maximum 20 roles per project" }, { status: 400 });
  }

  // Validate each role
  for (const role of b.roles) {
    if (!role || typeof role !== "object") {
      return NextResponse.json({ error: "Each role must be an object" }, { status: 400 });
    }
    const r = role as Record<string, unknown>;
    if (!r.role_name || typeof r.role_name !== "string") {
      return NextResponse.json({ error: "Each role must have a role_name" }, { status: 400 });
    }
    if (!r.category || typeof r.category !== "string") {
      return NextResponse.json({ error: "Each role must have a category" }, { status: 400 });
    }
  }

  const db = await ensureDb();
  const projectId = randomUUID();
  const maxParticipants = typeof b.max_participants === "number" ? Math.min(Math.max(b.max_participants, 2), 20) : 10;

  await db.execute({
    sql: "INSERT INTO projects (id, creator_agent_id, title, description, status, max_participants) VALUES (?, ?, ?, ?, 'open', ?)",
    args: [projectId, b.agent_id, b.title.trim(), (b.description as string)?.trim() || null, maxParticipants],
  });

  const roles: Array<{ id: string; role_name: string; category: string }> = [];
  for (const role of b.roles) {
    const r = role as Record<string, unknown>;
    const roleId = randomUUID();
    await db.execute({
      sql: "INSERT INTO project_roles (id, project_id, role_name, category, requirements) VALUES (?, ?, ?, ?, ?)",
      args: [roleId, projectId, (r.role_name as string).trim(), (r.category as string).trim(), r.requirements ? JSON.stringify(r.requirements) : "{}"],
    });
    roles.push({ id: roleId, role_name: (r.role_name as string).trim(), category: (r.category as string).trim() });
  }

  // Auto-add system message
  await db.execute({
    sql: "INSERT INTO project_messages (project_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'system')",
    args: [projectId, b.agent_id, `Project "${b.title}" created by ${b.agent_id} with ${roles.length} role(s)`],
  });

  return NextResponse.json({
    project_id: projectId,
    title: b.title,
    status: "open",
    roles,
    max_participants: maxParticipants,
  }, { status: 201 });
}

/** GET /api/projects - List/search projects */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, RATE_LIMITS.READ.prefix);
  if (rateLimited) return rateLimited;

  const db = await ensureDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const creatorId = searchParams.get("creator_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

  let sql = "SELECT * FROM projects WHERE 1=1";
  const args: unknown[] = [];

  if (status) {
    sql += " AND status = ?";
    args.push(status);
  }
  if (creatorId) {
    sql += " AND creator_agent_id = ?";
    args.push(creatorId);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  args.push(limit);

  const result = await db.execute({ sql, args });
  const projects = result.rows;

  // Get roles for each project, optionally filter by category
  const enriched = [];
  for (const p of projects) {
    let roleSql = "SELECT * FROM project_roles WHERE project_id = ?";
    const roleArgs: unknown[] = [p.id as string];
    if (category) {
      roleSql += " AND category = ?";
      roleArgs.push(category);
    }
    const rolesResult = await db.execute({ sql: roleSql, args: roleArgs });
    
    // If filtering by category and no roles match, skip this project
    if (category && rolesResult.rows.length === 0) continue;

    const roles = rolesResult.rows.map(r => ({
      id: r.id,
      role_name: r.role_name,
      category: r.category,
      requirements: JSON.parse(r.requirements as string || "{}"),
      filled_by_agent_id: r.filled_by_agent_id,
      filled: !!r.filled_by_agent_id,
    }));

    enriched.push({
      id: p.id,
      creator_agent_id: p.creator_agent_id,
      title: p.title,
      description: p.description,
      status: p.status,
      max_participants: p.max_participants,
      roles,
      roles_filled: roles.filter(r => r.filled).length,
      roles_total: roles.length,
      created_at: p.created_at,
    });
  }

  return NextResponse.json({ projects: enriched, count: enriched.length });
}
