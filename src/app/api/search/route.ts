import { NextRequest, NextResponse } from "next/server";
import { ensureDb, getTagsForProfiles } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/search - Search and discover active profiles
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const side = searchParams.get("side");
  const skills = searchParams.get("skill")?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const tags = searchParams.get("tags")?.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const q = searchParams.get("q");
  const excludeAgent = searchParams.get("exclude_agent");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20"), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0"), 0);

  if (side && side !== "offering" && side !== "seeking") {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }

  const db = await ensureDb();

  // Build query dynamically
  const conditions: string[] = ["p.active = 1"];
  const args: (string | number)[] = [];

  if (category) {
    conditions.push("p.category = ?");
    args.push(category);
  }

  if (side) {
    conditions.push("p.side = ?");
    args.push(side);
  }

  if (q) {
    conditions.push("p.description LIKE ?");
    args.push(`%${q}%`);
  }

  if (excludeAgent) {
    conditions.push("p.agent_id != ?");
    args.push(excludeAgent);
  }

  if (tags && tags.length > 0) {
    const tagPlaceholders = tags.map(() => "?").join(", ");
    conditions.push(`p.id IN (SELECT profile_id FROM profile_tags WHERE tag IN (${tagPlaceholders}))`);
    args.push(...tags);
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM profiles p WHERE ${whereClause}`,
    args,
  });
  const total = countResult.rows[0].total as number;

  const profilesResult = await db.execute({
    sql: `SELECT p.* FROM profiles p WHERE ${whereClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });
  const profiles = profilesResult.rows as unknown as Profile[];

  // Filter by skills in-memory (since params is JSON)
  let filtered = profiles;
  if (skills && skills.length > 0) {
    filtered = profiles.filter(p => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      const profileSkills = (profileParams.skills ?? []).map(s => s.toLowerCase());
      return skills.some(s => profileSkills.includes(s));
    });
  }

  const tagsMap = await getTagsForProfiles(db, filtered.map(p => p.id));

  return NextResponse.json({
    total: skills ? filtered.length : total,
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
        tags: tagsMap[p.id] ?? [],
        created_at: p.created_at,
      };
    }),
  });
}
