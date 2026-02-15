import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/search - Search and discover active profiles
 * 
 * Query params:
 *   category - filter by category (exact match)
 *   side - filter by side ('offering' or 'seeking')
 *   skill - filter by skill (comma-separated, matches any)
 *   q - free-text search in description
 *   limit - max results (default 20, max 100)
 *   offset - pagination offset (default 0)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const side = searchParams.get("side");
  const skills = searchParams.get("skill")?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const q = searchParams.get("q");
  const excludeAgent = searchParams.get("exclude_agent");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20"), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0"), 0);

  if (side && side !== "offering" && side !== "seeking") {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }

  const db = getDb();

  // Build query dynamically
  const conditions: string[] = ["active = 1"];
  const params: unknown[] = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  if (side) {
    conditions.push("side = ?");
    params.push(side);
  }

  if (q) {
    conditions.push("description LIKE ?");
    params.push(`%${q}%`);
  }

  if (excludeAgent) {
    conditions.push("agent_id != ?");
    params.push(excludeAgent);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = db.prepare(
    `SELECT COUNT(*) as total FROM profiles WHERE ${whereClause}`
  ).get(...params) as { total: number };

  const profiles = db.prepare(
    `SELECT * FROM profiles WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Profile[];

  // Filter by skills in-memory (since params is JSON)
  let filtered = profiles;
  if (skills && skills.length > 0) {
    filtered = profiles.filter(p => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      const profileSkills = (profileParams.skills ?? []).map(s => s.toLowerCase());
      return skills.some(s => profileSkills.includes(s));
    });
  }

  return NextResponse.json({
    total: skills ? filtered.length : countResult.total,
    limit,
    offset,
    profiles: filtered.map(p => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      return {
        id: p.id,
        agent_id: p.agent_id,
        side: p.side,
        category: p.category,
        skills: profileParams.skills ?? [],
        rate_range: profileParams.rate_min != null && profileParams.rate_max != null
          ? { min: profileParams.rate_min, max: profileParams.rate_max, currency: profileParams.currency ?? "USD" }
          : null,
        remote: profileParams.remote ?? null,
        description: p.description,
        created_at: p.created_at,
      };
    }),
  });
}
