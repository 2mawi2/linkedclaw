import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/admin/stats - Platform-wide statistics for operators.
 * Requires ADMIN_SECRET env var as Bearer token.
 *
 * Query params:
 *   days - lookback period for time-based stats (1-365, default 30)
 *
 * Returns: agents, listings, deals, messages, bounties, activity, growth metrics.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "admin-stats");
  if (rl) return rl;

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.max(1, Math.min(365, parseInt(daysParam || "30", 10) || 30));

  const db = await ensureDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Agent stats
  const agentResult = await db.execute(`
    SELECT
      COUNT(*) as total_agents,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_agents
    FROM users
  `, [cutoff]);
  const agents = agentResult.rows[0] as unknown as Record<string, number>;

  // Listing stats
  const listingResult = await db.execute(`
    SELECT
      COUNT(*) as total_listings,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_listings,
      SUM(CASE WHEN side = 'offering' AND active = 1 THEN 1 ELSE 0 END) as active_offering,
      SUM(CASE WHEN side = 'seeking' AND active = 1 THEN 1 ELSE 0 END) as active_seeking,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_listings,
      COUNT(DISTINCT agent_id) as agents_with_listings
    FROM profiles
  `, [cutoff]);
  const listings = listingResult.rows[0] as unknown as Record<string, number>;

  // Deal stats
  const dealResult = await db.execute(`
    SELECT
      COUNT(*) as total_deals,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) as matched,
      SUM(CASE WHEN status = 'negotiating' THEN 1 ELSE 0 END) as negotiating,
      SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as proposed,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_deals
    FROM matches
  `, [cutoff]);
  const deals = dealResult.rows[0] as unknown as Record<string, number>;

  // Message stats
  const msgResult = await db.execute(`
    SELECT
      COUNT(*) as total_messages,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as recent_messages,
      COUNT(DISTINCT match_id) as deals_with_messages
    FROM messages
  `, [cutoff]);
  const messages = msgResult.rows[0] as unknown as Record<string, number>;

  // Bounty stats
  let bounties: Record<string, number> = { total_bounties: 0, open_bounties: 0, new_bounties: 0 };
  try {
    const bountyResult = await db.execute(`
      SELECT
        COUNT(*) as total_bounties,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_bounties,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_bounties
      FROM bounties
    `, [cutoff]);
    bounties = bountyResult.rows[0] as unknown as Record<string, number>;
  } catch { /* table may not exist */ }

  // Review stats
  let reviews: Record<string, number> = { total_reviews: 0, recent_reviews: 0, avg_rating: 0 };
  try {
    const reviewResult = await db.execute(`
      SELECT
        COUNT(*) as total_reviews,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as recent_reviews,
        COALESCE(AVG(rating), 0) as avg_rating
      FROM reviews
    `, [cutoff]);
    reviews = reviewResult.rows[0] as unknown as Record<string, number>;
  } catch { /* table may not exist */ }

  // Top categories by active listings
  const catResult = await db.execute(`
    SELECT category, COUNT(*) as count
    FROM profiles WHERE active = 1 AND category IS NOT NULL
    GROUP BY category ORDER BY count DESC LIMIT 10
  `);
  const top_categories = catResult.rows as unknown as Array<{ category: string; count: number }>;

  // Daily active agents (agents who recorded activity in last N days)
  let daily_active_agents = 0;
  try {
    const dauResult = await db.execute(`
      SELECT COUNT(DISTINCT agent_id) as dau
      FROM agent_activity WHERE activity_date >= date(?)
    `, [cutoff]);
    daily_active_agents = Number((dauResult.rows[0] as unknown as Record<string, number>).dau) || 0;
  } catch { /* table may not exist */ }

  // Webhook stats
  let webhookStats: Record<string, number> = { total_webhooks: 0, active_webhooks: 0 };
  try {
    const whResult = await db.execute(`
      SELECT
        COUNT(*) as total_webhooks,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_webhooks
      FROM webhooks
    `);
    webhookStats = whResult.rows[0] as unknown as Record<string, number>;
  } catch { /* table may not exist */ }

  return NextResponse.json({
    period_days: days,
    generated_at: new Date().toISOString(),
    agents: {
      total: Number(agents.total_agents) || 0,
      new_in_period: Number(agents.new_agents) || 0,
      with_listings: Number(listings.agents_with_listings) || 0,
      active_in_period: daily_active_agents,
    },
    listings: {
      total: Number(listings.total_listings) || 0,
      active: Number(listings.active_listings) || 0,
      offering: Number(listings.active_offering) || 0,
      seeking: Number(listings.active_seeking) || 0,
      new_in_period: Number(listings.new_listings) || 0,
    },
    deals: {
      total: Number(deals.total_deals) || 0,
      new_in_period: Number(deals.new_deals) || 0,
      by_status: {
        matched: Number(deals.matched) || 0,
        negotiating: Number(deals.negotiating) || 0,
        proposed: Number(deals.proposed) || 0,
        approved: Number(deals.approved) || 0,
        completed: Number(deals.completed) || 0,
        rejected: Number(deals.rejected) || 0,
        expired: Number(deals.expired) || 0,
      },
    },
    messages: {
      total: Number(messages.total_messages) || 0,
      in_period: Number(messages.recent_messages) || 0,
      deals_with_messages: Number(messages.deals_with_messages) || 0,
    },
    bounties: {
      total: Number(bounties.total_bounties) || 0,
      open: Number(bounties.open_bounties) || 0,
      new_in_period: Number(bounties.new_bounties) || 0,
    },
    reviews: {
      total: Number(reviews.total_reviews) || 0,
      in_period: Number(reviews.recent_reviews) || 0,
      average_rating: Math.round(Number(reviews.avg_rating) * 100) / 100,
    },
    webhooks: {
      total: Number(webhookStats.total_webhooks) || 0,
      active: Number(webhookStats.active_webhooks) || 0,
    },
    top_categories,
  });
}
