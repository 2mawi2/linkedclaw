import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/agents/:agentId/summary
 * Public endpoint - returns a consolidated view of an agent's presence.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Active profiles
  const profilesResult = await db.execute({
    sql: `SELECT id, side, category, description, created_at
          FROM profiles WHERE agent_id = ? AND active = 1
          ORDER BY created_at DESC`,
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Array<{
    id: string;
    side: string;
    category: string;
    description: string | null;
    created_at: string;
  }>;

  // member_since: earliest profile created_at (including inactive)
  const memberSinceResult = await db.execute({
    sql: `SELECT MIN(created_at) as member_since FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const memberSince = (memberSinceResult.rows[0] as unknown as { member_since: string | null })
    .member_since;

  if (!memberSince) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // All profile IDs for this agent (including inactive, for match stats)
  const allProfilesResult = await db.execute({
    sql: `SELECT id FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const allProfileIds = (allProfilesResult.rows as unknown as Array<{ id: string }>).map(
    (p) => p.id,
  );

  let matchStats = { total_matches: 0, active_deals: 0, completed_deals: 0, success_rate: 0 };
  const placeholders = allProfileIds.map(() => "?").join(",");

  if (allProfileIds.length > 0) {
    const matchStatsResult = await db.execute({
      sql: `SELECT
              COUNT(*) as total_matches,
              SUM(CASE WHEN status IN ('matched', 'negotiating', 'proposed') THEN 1 ELSE 0 END) as active_deals,
              SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as completed_deals,
              SUM(CASE WHEN status = 'rejected' OR status = 'expired' THEN 1 ELSE 0 END) as failed_deals
            FROM matches
            WHERE profile_a_id IN (${placeholders}) OR profile_b_id IN (${placeholders})`,
      args: [...allProfileIds, ...allProfileIds],
    });
    const row = matchStatsResult.rows[0] as unknown as {
      total_matches: number;
      active_deals: number;
      completed_deals: number;
      failed_deals: number;
    };
    const total = Number(row.total_matches);
    const completed = Number(row.completed_deals);
    const failed = Number(row.failed_deals);
    const resolved = completed + failed;
    matchStats = {
      total_matches: total,
      active_deals: Number(row.active_deals),
      completed_deals: completed,
      success_rate: resolved > 0 ? Math.round((completed / resolved) * 100) / 100 : 0,
    };
  }

  // Recent activity: last 5 messages sent by this agent
  const recentActivityResult = await db.execute({
    sql: `SELECT m.match_id, m.content, m.message_type, m.created_at, m.sender_agent_id
          FROM messages m
          WHERE m.sender_agent_id = ?
          ORDER BY m.created_at DESC
          LIMIT 5`,
    args: [agentId],
  });
  const recentActivity = (
    recentActivityResult.rows as unknown as Array<{
      match_id: string;
      content: string;
      message_type: string;
      created_at: string;
      sender_agent_id: string;
    }>
  ).map((r) => ({
    match_id: r.match_id,
    type: r.message_type,
    content: r.content,
    created_at: r.created_at,
  }));

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const p of profiles) {
    categoryBreakdown[p.category] = (categoryBreakdown[p.category] || 0) + 1;
  }

  // Reputation
  const repResult = await db.execute({
    sql: `SELECT COUNT(*) as total_reviews, COALESCE(AVG(rating * 1.0), 0) as avg_rating
          FROM reviews WHERE reviewed_agent_id = ?`,
    args: [agentId],
  });
  const repRow = repResult.rows[0] as unknown as { total_reviews: number; avg_rating: number };
  const repTotal = Number(repRow.total_reviews);
  const avgRating = repTotal > 0 ? Math.round(Number(repRow.avg_rating) * 100) / 100 : 0;
  const reputation = {
    avg_rating: avgRating,
    total_reviews: repTotal,
  };

  // Verified categories: categories where agent has completed deals
  let verifiedCategories: Array<{ category: string; completed_deals: number; level: string }> = [];
  const badges: Array<{ id: string; name: string }> = [];

  if (allProfileIds.length > 0) {
    const completedResult = await db.execute({
      sql: `SELECT p.category, COUNT(DISTINCT m.id) as deal_count
            FROM matches m
            JOIN profiles p ON (p.id = m.profile_a_id OR p.id = m.profile_b_id)
            WHERE (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))
              AND m.status = 'completed'
              AND p.agent_id = ?
            GROUP BY p.category`,
      args: [...allProfileIds, ...allProfileIds, agentId],
    });

    verifiedCategories = (
      completedResult.rows as unknown as Array<{ category: string; deal_count: number }>
    )
      .map((r) => ({
        category: r.category,
        completed_deals: Number(r.deal_count),
        level:
          Number(r.deal_count) >= 10 ? "gold" : Number(r.deal_count) >= 3 ? "silver" : "bronze",
      }))
      .sort((a, b) => b.completed_deals - a.completed_deals);

    // Count total completed deals
    const totalCompletedResult = await db.execute({
      sql: `SELECT COUNT(*) as cnt FROM matches
            WHERE (profile_a_id IN (${placeholders}) OR profile_b_id IN (${placeholders}))
              AND status = 'completed'`,
      args: [...allProfileIds, ...allProfileIds],
    });
    const totalCompleted = Number((totalCompletedResult.rows[0] as unknown as { cnt: number }).cnt);

    // Build badges
    if (totalCompleted >= 1) badges.push({ id: "first_deal", name: "First Deal" });
    if (totalCompleted >= 5) badges.push({ id: "prolific", name: "Prolific" });
    if (totalCompleted >= 10) badges.push({ id: "veteran", name: "Veteran" });
    if (verifiedCategories.length >= 3)
      badges.push({ id: "multi_category", name: "Multi-Category" });
    if (repTotal >= 3 && avgRating >= 4.0)
      badges.push({ id: "highly_rated", name: "Highly Rated" });
    if (repTotal >= 3 && avgRating >= 4.8) badges.push({ id: "exceptional", name: "Exceptional" });
  }

  return NextResponse.json({
    agent_id: agentId,
    profile_count: profiles.length,
    active_profiles: profiles.map((p) => ({
      id: p.id,
      side: p.side,
      category: p.category,
      description: p.description,
    })),
    match_stats: matchStats,
    reputation,
    verified_categories: verifiedCategories,
    badges,
    recent_activity: recentActivity,
    member_since: memberSince,
    category_breakdown: categoryBreakdown,
  });
}
