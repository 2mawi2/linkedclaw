import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/stats - Platform statistics and health check
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "stats");
  if (rl) return rl;
  const db = await ensureDb();

  const profileStatsResult = await db.execute(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN side = 'offering' AND active = 1 THEN 1 ELSE 0 END) as offering,
      SUM(CASE WHEN side = 'seeking' AND active = 1 THEN 1 ELSE 0 END) as seeking,
      COUNT(DISTINCT agent_id) as unique_agents
    FROM profiles
  `);
  const profileStats = profileStatsResult.rows[0] as unknown as Record<string, number>;

  const matchStatsResult = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) as matched,
      SUM(CASE WHEN status = 'negotiating' THEN 1 ELSE 0 END) as negotiating,
      SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as proposed,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
    FROM matches
  `);
  const matchStats = matchStatsResult.rows[0] as unknown as Record<string, number>;

  const messageCountResult = await db.execute("SELECT COUNT(*) as total FROM messages");
  const messageCount = messageCountResult.rows[0] as unknown as { total: number };

  const categoriesResult = await db.execute(`
    SELECT category, COUNT(*) as count 
    FROM profiles WHERE active = 1 
    GROUP BY category ORDER BY count DESC LIMIT 10
  `);
  const categories = categoriesResult.rows as unknown as Array<{ category: string; count: number }>;

  return NextResponse.json({
    status: "healthy",
    version: "0.2.0",
    profiles: {
      total: profileStats.total,
      active: profileStats.active,
      offering: profileStats.offering,
      seeking: profileStats.seeking,
      unique_agents: profileStats.unique_agents,
    },
    matches: {
      total: matchStats.total,
      by_status: {
        matched: matchStats.matched,
        negotiating: matchStats.negotiating,
        proposed: matchStats.proposed,
        approved: matchStats.approved,
        rejected: matchStats.rejected,
        expired: matchStats.expired,
      },
    },
    messages: { total: messageCount.total },
    top_categories: categories,
  });
}
