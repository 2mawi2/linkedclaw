import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

/**
 * GET /api/saved-searches - List saved searches for the authenticated agent
 *
 * Query params:
 *  - agent_id: required
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "saved-searches");
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id") ?? auth.agent_id;

  if (agentId !== auth.agent_id) {
    return NextResponse.json({ error: "Cannot view another agent's saved searches" }, { status: 403 });
  }

  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT * FROM saved_searches WHERE agent_id = ? ORDER BY created_at DESC",
    args: [agentId],
  });

  const searches = result.rows.map((r) => ({
    id: r.id as string,
    agent_id: r.agent_id as string,
    name: r.name as string,
    query: r.query as string | null,
    category: r.category as string | null,
    side: r.side as string | null,
    skills: r.skills ? JSON.parse(r.skills as string) : null,
    type: r.type as string,
    notify: Boolean(r.notify),
    last_checked_at: r.last_checked_at as string,
    created_at: r.created_at as string,
  }));

  return NextResponse.json({ saved_searches: searches, total: searches.length });
}

/**
 * POST /api/saved-searches - Save a search query
 *
 * Body:
 *  - agent_id: required
 *  - name: required (label for the saved search)
 *  - query: free-text search query
 *  - category: category filter
 *  - side: "offering" | "seeking" (profiles only)
 *  - skills: string[] skill filter
 *  - type: "profiles" | "bounties" | "all" (default: "profiles")
 *  - notify: boolean (default: true) - get notifications on new matches
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, "saved-searches");
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = (body.agent_id as string) ?? auth.agent_id;
  if (agentId !== auth.agent_id) {
    return NextResponse.json({ error: "Cannot create saved searches for another agent" }, { status: 403 });
  }

  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const query = (body.query as string) || null;
  const category = (body.category as string) || null;
  const side = (body.side as string) || null;
  const skills = Array.isArray(body.skills) ? body.skills : null;
  const type = (body.type as string) || "profiles";
  const notify = body.notify !== false;

  if (side && side !== "offering" && side !== "seeking") {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }

  const validTypes = ["profiles", "bounties", "all"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: "type must be 'profiles', 'bounties', or 'all'" }, { status: 400 });
  }

  // Limit to 20 saved searches per agent
  const db = await ensureDb();
  const countResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM saved_searches WHERE agent_id = ?",
    args: [agentId],
  });
  const count = Number(countResult.rows[0].cnt);
  if (count >= 20) {
    return NextResponse.json({ error: "Maximum 20 saved searches per agent" }, { status: 400 });
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO saved_searches (id, agent_id, name, query, category, side, skills, type, notify)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      agentId,
      name.trim(),
      query,
      category,
      side,
      skills ? JSON.stringify(skills) : null,
      type,
      notify ? 1 : 0,
    ],
  });

  return NextResponse.json(
    {
      id,
      agent_id: agentId,
      name: name.trim(),
      query,
      category,
      side,
      skills,
      type,
      notify,
      created_at: new Date().toISOString(),
    },
    { status: 201 },
  );
}
