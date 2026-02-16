import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/analytics - Platform-wide deal analytics
 *
 * Returns aggregated stats: deals by status, avg time to close,
 * popular categories, activity over time, and bounty stats.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "analytics");
  if (rl) return rl;

  const db = await ensureDb();

  // Deal counts by status
  const dealsByStatus = await db.execute(`
    SELECT status, COUNT(*) as count
    FROM matches
    GROUP BY status
    ORDER BY count DESC
  `);

  // Total deals and completed deals
  const totalsResult = await db.execute(`
    SELECT
      COUNT(*) as total_deals,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status IN ('matched', 'negotiating', 'proposed', 'in_progress') THEN 1 ELSE 0 END) as active
    FROM matches
  `);
  const totals = totalsResult.rows[0] as unknown as Record<string, number>;

  // Average time from creation to completion (for completed deals)
  // SQLite doesn't have DATEDIFF, so we use julianday
  const avgTimeResult = await db.execute(`
    SELECT
      AVG(
        julianday(dc.completed_at) - julianday(m.created_at)
      ) as avg_days_to_close
    FROM matches m
    JOIN deal_completions dc ON dc.match_id = m.id
    WHERE m.status = 'completed'
  `);
  const avgDays = (avgTimeResult.rows[0] as unknown as { avg_days_to_close: number | null })
    .avg_days_to_close;

  // Popular categories (by deal count)
  const categoryDeals = await db.execute(`
    SELECT p.category, COUNT(DISTINCT m.id) as deal_count
    FROM matches m
    JOIN profiles p ON p.id = m.profile_a_id
    GROUP BY p.category
    ORDER BY deal_count DESC
    LIMIT 10
  `);

  // Deals over time (last 30 days, grouped by day)
  const dealsOverTime = await db.execute(`
    SELECT
      date(created_at) as day,
      COUNT(*) as count
    FROM matches
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `);

  // Messages over time (last 30 days)
  const messagesOverTime = await db.execute(`
    SELECT
      date(created_at) as day,
      COUNT(*) as count
    FROM messages
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `);

  // Top agents by completed deals
  const topAgents = await db.execute(`
    SELECT agent_id, COUNT(*) as completed_deals
    FROM (
      SELECT p.agent_id
      FROM matches m
      JOIN profiles p ON p.id = m.profile_a_id
      WHERE m.status IN ('completed', 'approved')
      UNION ALL
      SELECT p.agent_id
      FROM matches m
      JOIN profiles p ON p.id = m.profile_b_id
      WHERE m.status IN ('completed', 'approved')
    )
    GROUP BY agent_id
    ORDER BY completed_deals DESC
    LIMIT 10
  `);

  // Bounty stats
  const bountyStats = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      AVG(budget_max) as avg_budget
    FROM bounties
  `);
  const bounties = bountyStats.rows[0] as unknown as Record<string, number | null>;

  // Unique agents count
  const agentCount = await db.execute(`
    SELECT COUNT(DISTINCT agent_id) as count FROM profiles WHERE active = 1
  `);
  const uniqueAgents = (agentCount.rows[0] as unknown as { count: number }).count;

  return NextResponse.json({
    overview: {
      total_deals: totals.total_deals || 0,
      completed_deals: (totals.completed || 0) + (totals.approved || 0),
      active_deals: totals.active || 0,
      unique_agents: uniqueAgents || 0,
      avg_days_to_close: avgDays ? Math.round(avgDays * 10) / 10 : null,
    },
    deals_by_status: dealsByStatus.rows,
    category_breakdown: categoryDeals.rows,
    deals_over_time: dealsOverTime.rows,
    messages_over_time: messagesOverTime.rows,
    top_agents: topAgents.rows,
    bounties: {
      total: bounties.total || 0,
      open: bounties.open || 0,
      completed: bounties.completed || 0,
      in_progress: bounties.in_progress || 0,
      avg_budget: bounties.avg_budget ? Math.round(bounties.avg_budget) : null,
    },
  });
}
