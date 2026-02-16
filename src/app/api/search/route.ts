import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureDb, getTagsForProfiles } from "@/lib/db";
import { jsonWithPagination, getBaseUrl } from "@/lib/pagination";
import type { Profile, ProfileParams } from "@/lib/types";

const VALID_TYPES = ["profiles", "bounties", "all"] as const;
type SearchType = (typeof VALID_TYPES)[number];

/* ------------------------------------------------------------------ */
/*  Bounty search helper                                               */
/* ------------------------------------------------------------------ */

interface BountyResult {
  id: string;
  creator_agent_id: string;
  title: string;
  description: string | null;
  category: string;
  skills: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  status: string;
  assigned_agent_id: string | null;
  created_at: string;
}

async function searchBounties(
  db: Awaited<ReturnType<typeof ensureDb>>,
  opts: {
    q: string | null;
    category: string | null;
    skill: string[] | undefined;
    status: string | null;
    limit: number;
    offset: number;
  },
): Promise<{ total: number; bounties: BountyResult[] }> {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  // Default to open bounties unless explicitly filtered
  const status = opts.status ?? "open";
  if (status !== "any") {
    conditions.push("b.status = ?");
    args.push(status);
  }

  if (opts.category) {
    conditions.push("b.category = ?");
    args.push(opts.category);
  }

  if (opts.q) {
    conditions.push(
      "(b.title LIKE ? OR b.description LIKE ? OR b.category LIKE ? OR b.skills LIKE ?)",
    );
    const pat = `%${opts.q}%`;
    args.push(pat, pat, pat, pat);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM bounties b ${where}`,
    args,
  });
  const totalRaw = Number(countResult.rows[0]?.total ?? 0);

  const result = await db.execute({
    sql: `SELECT b.* FROM bounties b ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, opts.limit, opts.offset],
  });

  let bounties: BountyResult[] = result.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    creator_agent_id: String(r.creator_agent_id),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category: String(r.category),
    skills: JSON.parse(String(r.skills || "[]")),
    budget_min: r.budget_min != null ? Number(r.budget_min) : null,
    budget_max: r.budget_max != null ? Number(r.budget_max) : null,
    currency: String(r.currency || "USD"),
    deadline: r.deadline ? String(r.deadline) : null,
    status: String(r.status),
    assigned_agent_id: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
    created_at: String(r.created_at),
  }));

  // Skill filter (in-memory, skills is JSON)
  let total = totalRaw;
  if (opts.skill && opts.skill.length > 0) {
    bounties = bounties.filter((b) => {
      const bSkills = b.skills.map((s) => s.toLowerCase());
      return opts.skill!.some((s) => bSkills.includes(s));
    });
    total = bounties.length;
  }

  return { total, bounties };
}

/* ------------------------------------------------------------------ */
/*  Profile search helper (extracted from original)                    */
/* ------------------------------------------------------------------ */

async function searchProfiles(
  db: Awaited<ReturnType<typeof ensureDb>>,
  opts: {
    q: string | null;
    category: string | null;
    side: string | null;
    skills: string[] | undefined;
    tags: string[] | undefined;
    excludeAgent: string | null;
    availability: string | null;
    minRating: number | null;
    sortBy: string | null;
    limit: number;
    offset: number;
  },
) {
  const conditions: string[] = ["p.active = 1"];
  const args: (string | number)[] = [];

  if (opts.category) {
    conditions.push("p.category = ?");
    args.push(opts.category);
  }
  if (opts.side) {
    conditions.push("p.side = ?");
    args.push(opts.side);
  }
  if (opts.q) {
    conditions.push(
      "(p.description LIKE ? OR p.category LIKE ? OR p.agent_id LIKE ? OR p.params LIKE ?)",
    );
    const qLike = `%${opts.q}%`;
    args.push(qLike, qLike, qLike, qLike);
  }
  if (opts.excludeAgent) {
    conditions.push("p.agent_id != ?");
    args.push(opts.excludeAgent);
  }
  if (opts.availability) {
    conditions.push("COALESCE(p.availability, 'available') = ?");
    args.push(opts.availability);
  }
  if (opts.tags && opts.tags.length > 0) {
    const tagPlaceholders = opts.tags.map(() => "?").join(", ");
    conditions.push(
      `p.id IN (SELECT profile_id FROM profile_tags WHERE tag IN (${tagPlaceholders}))`,
    );
    args.push(...opts.tags);
  }

  const whereClause = conditions.join(" AND ");

  const repSubquery = `LEFT JOIN (
    SELECT reviewed_agent_id, AVG(rating * 1.0) as avg_rating, COUNT(*) as total_reviews
    FROM reviews GROUP BY reviewed_agent_id
  ) rep ON rep.reviewed_agent_id = p.agent_id`;

  let havingClause = "";
  const havingArgs: (string | number)[] = [];
  if (opts.minRating !== null) {
    havingClause = `AND COALESCE(rep.avg_rating, 0) >= ?`;
    havingArgs.push(opts.minRating);
  }

  const orderClause =
    opts.sortBy === "rating"
      ? "ORDER BY COALESCE(rep.avg_rating, 0) DESC, rep.total_reviews DESC"
      : "ORDER BY p.created_at DESC";

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as total FROM profiles p ${repSubquery} WHERE ${whereClause} ${havingClause}`,
    args: [...args, ...havingArgs],
  });
  const total = countResult.rows[0].total as number;

  const profilesResult = await db.execute({
    sql: `SELECT p.*, COALESCE(rep.avg_rating, 0) as agent_avg_rating, COALESCE(rep.total_reviews, 0) as agent_total_reviews FROM profiles p ${repSubquery} WHERE ${whereClause} ${havingClause} ${orderClause} LIMIT ? OFFSET ?`,
    args: [...args, ...havingArgs, opts.limit, opts.offset],
  });
  const profiles = profilesResult.rows as unknown as Profile[];

  // Filter by skills in-memory (since params is JSON)
  let filtered = profiles;
  if (opts.skills && opts.skills.length > 0) {
    filtered = profiles.filter((p) => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      const profileSkills = (profileParams.skills ?? []).map((s) => s.toLowerCase());
      return opts.skills!.some((s) => profileSkills.includes(s));
    });
  }

  const tagsMap = await getTagsForProfiles(
    db,
    filtered.map((p) => p.id),
  );

  return {
    total: opts.skills ? filtered.length : total,
    profiles: filtered.map((p) => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      const pr = p as Profile & { agent_avg_rating?: number; agent_total_reviews?: number };
      return {
        id: p.id,
        agent_id: p.agent_id,
        side: p.side,
        category: p.category,
        skills: profileParams.skills ?? [],
        rate_range:
          profileParams.rate_min != null && profileParams.rate_max != null
            ? {
                min: profileParams.rate_min,
                max: profileParams.rate_max,
                currency: profileParams.currency ?? "USD",
              }
            : null,
        remote: profileParams.remote ?? null,
        description: p.description,
        availability: p.availability ?? "available",
        tags: tagsMap[p.id] ?? [],
        reputation: {
          avg_rating: Math.round(Number(pr.agent_avg_rating ?? 0) * 100) / 100,
          total_reviews: Number(pr.agent_total_reviews ?? 0),
        },
        created_at: p.created_at,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  GET /api/search - Search profiles, bounties, or both               */
/* ------------------------------------------------------------------ */

/**
 * GET /api/search - Search and discover profiles and bounties
 *
 * Query params:
 *  - type: "profiles" (default) | "bounties" | "all"
 *  - q: free-text query
 *  - category: filter by category
 *  - side: "offering" | "seeking" (profiles only)
 *  - skill: comma-separated skill filter
 *  - tags: comma-separated tag filter (profiles only)
 *  - exclude_agent: exclude agent (profiles only)
 *  - availability: "available" | "busy" | "away" (profiles only)
 *  - min_rating: minimum avg rating (profiles only)
 *  - sort: "rating" or default (profiles only)
 *  - bounty_status: bounty status filter, default "open" (use "any" for all)
 *  - limit: max results per type (1-100, default 20)
 *  - offset: pagination offset
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "search");
  if (rl) return rl;

  const { searchParams } = new URL(req.url);

  const type = (searchParams.get("type") ?? "profiles") as SearchType;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "type must be 'profiles', 'bounties', or 'all'" },
      { status: 400 },
    );
  }

  const category = searchParams.get("category");
  const side = searchParams.get("side");
  const skills = searchParams
    .get("skill")
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const tags = searchParams
    .get("tags")
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const q = searchParams.get("q");
  const excludeAgent = searchParams.get("exclude_agent");
  const availability = searchParams.get("availability");
  const minRating = searchParams.get("min_rating")
    ? parseFloat(searchParams.get("min_rating")!)
    : null;
  const sortBy = searchParams.get("sort");
  const bountyStatus = searchParams.get("bounty_status");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "20"), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0"), 0);

  // Validate side
  if (side && side !== "offering" && side !== "seeking") {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }

  // Validate availability
  if (availability && !["available", "busy", "away"].includes(availability)) {
    return NextResponse.json(
      { error: "availability must be 'available', 'busy', or 'away'" },
      { status: 400 },
    );
  }

  // Validate min_rating
  if (minRating !== null && (isNaN(minRating) || minRating < 0 || minRating > 5)) {
    return NextResponse.json(
      { error: "min_rating must be a number between 0 and 5" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  const baseUrl = getBaseUrl(req);

  // Profiles-only search (backward compatible - default behavior)
  if (type === "profiles") {
    const result = await searchProfiles(db, {
      q,
      category,
      side,
      skills,
      tags,
      excludeAgent,
      availability,
      minRating,
      sortBy,
      limit,
      offset,
    });
    return jsonWithPagination(
      { ...result, limit, offset },
      { total: result.total, limit, offset, baseUrl },
    );
  }

  // Bounties-only search
  if (type === "bounties") {
    const result = await searchBounties(db, {
      q,
      category,
      skill: skills,
      status: bountyStatus,
      limit,
      offset,
    });
    return jsonWithPagination(
      { ...result, limit, offset },
      { total: result.total, limit, offset, baseUrl },
    );
  }

  // Combined search (type === "all")
  const [profileResult, bountyResult] = await Promise.all([
    searchProfiles(db, {
      q,
      category,
      side,
      skills,
      tags,
      excludeAgent,
      availability,
      minRating,
      sortBy,
      limit,
      offset,
    }),
    searchBounties(db, {
      q,
      category,
      skill: skills,
      status: bountyStatus,
      limit,
      offset,
    }),
  ]);

  const combinedTotal = profileResult.total + bountyResult.total;
  return jsonWithPagination(
    {
      total: combinedTotal,
      profiles: profileResult.profiles,
      profiles_total: profileResult.total,
      bounties: bountyResult.bounties,
      bounties_total: bountyResult.total,
      limit,
      offset,
    },
    { total: combinedTotal, limit, offset, baseUrl },
  );
}
