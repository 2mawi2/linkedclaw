import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/saved-searches/check - Check all saved searches for new matches
 *
 * Runs each saved search and returns items created since last_checked_at.
 * Updates last_checked_at after checking.
 *
 * Body:
 *  - agent_id: required
 *
 * Returns:
 *  - results: array of { search_id, search_name, new_profiles, new_bounties }
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    "saved-searches-check",
  );
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
    return NextResponse.json(
      { error: "Cannot check another agent's saved searches" },
      { status: 403 },
    );
  }

  const db = await ensureDb();

  // Get all saved searches with notify enabled
  const searches = await db.execute({
    sql: "SELECT * FROM saved_searches WHERE agent_id = ? AND notify = 1",
    args: [agentId],
  });

  const results = [];

  for (const search of searches.rows) {
    const lastChecked = search.last_checked_at as string;
    const searchType = (search.type as string) || "profiles";
    const searchQuery = search.query as string | null;
    const searchCategory = search.category as string | null;
    const searchSide = search.side as string | null;
    const searchSkills: string[] = search.skills ? JSON.parse(search.skills as string) : [];

    let newProfiles: Record<string, unknown>[] = [];
    let newBounties: Record<string, unknown>[] = [];

    // Check for new profiles
    if (searchType === "profiles" || searchType === "all") {
      const conditions: string[] = ["p.active = 1", "p.created_at > ?"];
      const args: (string | number)[] = [lastChecked];

      if (searchCategory) {
        conditions.push("p.category = ?");
        args.push(searchCategory);
      }
      if (searchSide) {
        conditions.push("p.side = ?");
        args.push(searchSide);
      }
      if (searchQuery) {
        conditions.push(
          "(p.description LIKE ? OR p.category LIKE ? OR p.agent_id LIKE ? OR p.params LIKE ?)",
        );
        const pat = `%${searchQuery}%`;
        args.push(pat, pat, pat, pat);
      }

      const profileResult = await db.execute({
        sql: `SELECT p.id, p.agent_id, p.side, p.category, p.description, p.created_at
              FROM profiles p WHERE ${conditions.join(" AND ")}
              ORDER BY p.created_at DESC LIMIT 50`,
        args,
      });

      let profiles = profileResult.rows.map((r) => ({
        id: r.id as string,
        agent_id: r.agent_id as string,
        side: r.side as string,
        category: r.category as string,
        description: r.description as string | null,
        params: r.params ? JSON.parse(r.params as string) : {},
        created_at: r.created_at as string,
      }));

      // Filter by skills in-memory
      if (searchSkills.length > 0) {
        profiles = profiles.filter((p) => {
          const pSkills = (p.params?.skills ?? []).map((s: string) => s.toLowerCase());
          return searchSkills.some((s) => pSkills.includes(s.toLowerCase()));
        });
      }

      newProfiles = profiles;
    }

    // Check for new bounties
    if (searchType === "bounties" || searchType === "all") {
      const conditions: string[] = ["b.status = 'open'", "b.created_at > ?"];
      const args: (string | number)[] = [lastChecked];

      if (searchCategory) {
        conditions.push("b.category = ?");
        args.push(searchCategory);
      }
      if (searchQuery) {
        conditions.push(
          "(b.title LIKE ? OR b.description LIKE ? OR b.category LIKE ? OR b.skills LIKE ?)",
        );
        const pat = `%${searchQuery}%`;
        args.push(pat, pat, pat, pat);
      }

      const bountyResult = await db.execute({
        sql: `SELECT b.id, b.creator_agent_id, b.title, b.description, b.category, b.skills,
                     b.budget_min, b.budget_max, b.currency, b.status, b.created_at
              FROM bounties b WHERE ${conditions.join(" AND ")}
              ORDER BY b.created_at DESC LIMIT 50`,
        args,
      });

      let bounties = bountyResult.rows.map((r) => ({
        id: r.id as string,
        creator_agent_id: r.creator_agent_id as string,
        title: r.title as string,
        description: r.description as string | null,
        category: r.category as string,
        skills: JSON.parse((r.skills as string) || "[]"),
        budget_min: r.budget_min != null ? Number(r.budget_min) : null,
        budget_max: r.budget_max != null ? Number(r.budget_max) : null,
        currency: r.currency as string,
        status: r.status as string,
        created_at: r.created_at as string,
      }));

      // Filter by skills in-memory
      if (searchSkills.length > 0) {
        bounties = bounties.filter((b) => {
          const bSkills = b.skills.map((s: string) => s.toLowerCase());
          return searchSkills.some((s) => bSkills.includes(s.toLowerCase()));
        });
      }

      newBounties = bounties;
    }

    // Update last_checked_at
    await db.execute({
      sql: "UPDATE saved_searches SET last_checked_at = datetime('now') WHERE id = ?",
      args: [search.id as string],
    });

    // Only include searches with new results
    const totalNew = newProfiles.length + newBounties.length;
    if (totalNew > 0) {
      results.push({
        search_id: search.id as string,
        search_name: search.name as string,
        new_profiles: newProfiles.length > 0 ? newProfiles : undefined,
        new_bounties: newBounties.length > 0 ? newBounties : undefined,
        total_new: totalNew,
      });
    }
  }

  return NextResponse.json({
    checked: searches.rows.length,
    results,
    total_new: results.reduce((sum, r) => sum + r.total_new, 0),
  });
}
