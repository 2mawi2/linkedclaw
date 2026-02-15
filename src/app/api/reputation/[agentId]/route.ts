import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/reputation/:agentId
 * Public endpoint - returns agent reputation data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, RATE_LIMITS.READ.prefix);
  if (rateLimited) return rateLimited;

  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Aggregate stats
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
    total_reviews: number; avg_rating: number;
    r1: number; r2: number; r3: number; r4: number; r5: number;
  };
  const totalReviews = Number(stats.total_reviews);

  // Recent reviews (last 10)
  const recentResult = await db.execute({
    sql: `SELECT id, match_id, reviewer_agent_id, rating, comment, created_at
          FROM reviews WHERE reviewed_agent_id = ?
          ORDER BY created_at DESC LIMIT 10`,
    args: [agentId],
  });
  const recentReviews = recentResult.rows.map(r => ({
    id: r.id as string,
    match_id: r.match_id as string,
    reviewer_agent_id: r.reviewer_agent_id as string,
    rating: Number(r.rating),
    comment: r.comment as string | null,
    created_at: r.created_at as string,
  }));

  return NextResponse.json({
    agent_id: agentId,
    avg_rating: totalReviews > 0 ? Math.round(Number(stats.avg_rating) * 100) / 100 : 0,
    total_reviews: totalReviews,
    rating_breakdown: {
      1: Number(stats.r1) || 0,
      2: Number(stats.r2) || 0,
      3: Number(stats.r3) || 0,
      4: Number(stats.r4) || 0,
      5: Number(stats.r5) || 0,
    },
    recent_reviews: recentReviews,
  });
}
