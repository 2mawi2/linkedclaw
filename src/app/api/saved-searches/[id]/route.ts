import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/saved-searches/:id - Get a single saved search
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "saved-searches",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT * FROM saved_searches WHERE id = ?",
    args: [id],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Saved search not found" }, { status: 404 });
  }

  const r = result.rows[0];
  if (r.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  return NextResponse.json({
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
  });
}

/**
 * PATCH /api/saved-searches/:id - Update a saved search
 *
 * Body (all optional):
 *  - name: string
 *  - query: string | null
 *  - category: string | null
 *  - side: string | null
 *  - skills: string[] | null
 *  - type: string
 *  - notify: boolean
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    "saved-searches",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = await ensureDb();

  const existing = await db.execute({
    sql: "SELECT * FROM saved_searches WHERE id = ?",
    args: [id],
  });

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Saved search not found" }, { status: 404 });
  }

  if (existing.rows[0].agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    updates.push("name = ?");
    args.push((body.name as string).trim());
  }

  if ("query" in body) {
    updates.push("query = ?");
    args.push((body.query as string) || null);
  }

  if ("category" in body) {
    updates.push("category = ?");
    args.push((body.category as string) || null);
  }

  if ("side" in body) {
    const side = body.side as string | null;
    if (side && side !== "offering" && side !== "seeking") {
      return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
    }
    updates.push("side = ?");
    args.push(side);
  }

  if ("skills" in body) {
    updates.push("skills = ?");
    args.push(body.skills ? JSON.stringify(body.skills) : null);
  }

  if ("type" in body) {
    const type = body.type as string;
    if (!["profiles", "bounties", "all"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'profiles', 'bounties', or 'all'" },
        { status: 400 },
      );
    }
    updates.push("type = ?");
    args.push(type);
  }

  if ("notify" in body) {
    updates.push("notify = ?");
    args.push(body.notify ? 1 : 0);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE saved_searches SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  // Return updated record
  const updated = await db.execute({
    sql: "SELECT * FROM saved_searches WHERE id = ?",
    args: [id],
  });
  const r = updated.rows[0];

  return NextResponse.json({
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
  });
}

/**
 * DELETE /api/saved-searches/:id - Delete a saved search
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    "saved-searches",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = await ensureDb();

  const existing = await db.execute({
    sql: "SELECT agent_id FROM saved_searches WHERE id = ?",
    args: [id],
  });

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Saved search not found" }, { status: 404 });
  }

  if (existing.rows[0].agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await db.execute({
    sql: "DELETE FROM saved_searches WHERE id = ?",
    args: [id],
  });

  return NextResponse.json({ deleted: true, id });
}
