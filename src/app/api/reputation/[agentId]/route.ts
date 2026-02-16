import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { computeReputationScore } from "@/lib/reputation";

/**
 * GET /api/reputation/:agentId
 * Public endpoint - returns agent reputation data including composite score.
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

  // Aggregate review stats
  const statsResult = await db.execute({
    sql: `SELECT
            COUNT(*) as total_reviews,
            COALESCE(AVG(rating * 1.0), 0) as avg_rating,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as r1,
            SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as r2,
            SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as r3,
            SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as r4,
            SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as r5
          FROM reviews WHERE reviewed_agent_id = ?`,
    args: [agentId],
  });
  const stats = statsResult.rows[0] as unknown as {
    total_reviews: number;
    avg_rating: number;
    r1: number;
    r2: number;
    r3: number;
    r4: number;
    r5: number;
  };
  const totalReviews = Number(stats.total_reviews);
  const avgRating = totalReviews > 0 ? Number(stats.avg_rating) : 0;

  // Deal stats for composite score
  const allProfilesResult = await db.execute({
    sql: `SELECT id FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const allProfileIds = (allProfilesResult.rows as unknown as Array<{ id: string }>).map(
    (p) => p.id,
  );

  let completedDeals = 0;
  let totalResolvedDeals = 0;

  if (allProfileIds.length > 0) {
    const ph = allProfileIds.map(() => "?").join(",");
    const dealStatsResult = await db.execute({
      sql: `SELECT
              SUM(CASE WHEN status IN ('approved', 'completed', 'in_progress') THEN 1 ELSE 0 END) as completed,
              SUM(CASE WHEN status IN ('approved', 'completed', 'in_progress', 'rejected', 'expired') THEN 1 ELSE 0 END) as resolved
            FROM matches
            WHERE profile_a_id IN (${ph}) OR profile_b_id IN (${ph})`,
      args: [...allProfileIds, ...allProfileIds],
    });
    const dealStats = dealStatsResult.rows[0] as unknown as {
      completed: number;
      resolved: number;
    };
    completedDeals = Number(dealStats.completed) || 0;
    totalResolvedDeals = Number(dealStats.resolved) || 0;
  }

  // Compute composite score
  const reputation = computeReputationScore({
    avg_rating: avgRating,
    total_reviews: totalReviews,
    completed_deals: completedDeals,
    total_resolved_deals: totalResolvedDeals,
  });

  // Recent reviews (last 10)
  const recentResult = await db.execute({
    sql: `SELECT id, match_id, reviewer_agent_id, rating, comment, created_at
          FROM reviews WHERE reviewed_agent_id = ?
          ORDER BY created_at DESC LIMIT 10`,
    args: [agentId],
  });
  const recentReviews = recentResult.rows.map((r) => ({
    id: r.id as string,
    match_id: r.match_id as string,
    reviewer_agent_id: r.reviewer_agent_id as string,
    rating: Number(r.rating),
    comment: r.comment as string | null,
    created_at: r.created_at as string,
  }));

  return NextResponse.json({
    agent_id: agentId,
    reputation_score: reputation.score,
    reputation_level: reputation.level,
    score_components: reputation.components,
    avg_rating: totalReviews > 0 ? Math.round(avgRating * 100) / 100 : 0,
    total_reviews: totalReviews,
    rating_breakdown: {
      1: Number(stats.r1) || 0,
      2: Number(stats.r2) || 0,
      3: Number(stats.r3) || 0,
      4: Number(stats.r4) || 0,
      5: Number(stats.r5) || 0,
    },
    deal_stats: {
      completed_deals: completedDeals,
      total_resolved_deals: totalResolvedDeals,
    },
    recent_reviews: recentReviews,
  });
}
