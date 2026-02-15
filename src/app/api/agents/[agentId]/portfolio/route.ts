import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/agents/:agentId/portfolio
 * Public endpoint - returns an agent's verified track record.
 * Shows completed deals with categories, counterpart info, ratings, and milestones.
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

  // Check agent exists
  const agentCheck = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  if (Number((agentCheck.rows[0] as unknown as { cnt: number }).cnt) === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Get all profile IDs for this agent
  const profilesResult = await db.execute({
    sql: `SELECT id, category, side FROM profiles WHERE agent_id = ?`,
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Array<{ id: string; category: string; side: string }>;
  const profileIds = profiles.map(p => p.id);

  if (profileIds.length === 0) {
    return NextResponse.json({
      agent_id: agentId,
      completed_deals: [],
      verified_categories: [],
      badges: [],
      stats: { total_completed: 0, categories_worked: 0, avg_rating_received: 0 },
    });
  }

  const placeholders = profileIds.map(() => "?").join(",");
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  // Get completed/approved deals where this agent participated
  const dealsResult = await db.execute({
    sql: `SELECT m.id, m.profile_a_id, m.profile_b_id, m.status, m.created_at,
            pa.agent_id as agent_a, pa.category as cat_a, pa.side as side_a,
            pb.agent_id as agent_b, pb.category as cat_b, pb.side as side_b
          FROM matches m
          JOIN profiles pa ON pa.id = m.profile_a_id
          JOIN profiles pb ON pb.id = m.profile_b_id
          WHERE (m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders}))
            AND m.status IN ('completed', 'in_progress', 'approved')
          ORDER BY m.created_at DESC`,
    args: [...profileIds, ...profileIds],
  });

  const deals = dealsResult.rows as unknown as Array<{
    id: string; profile_a_id: string; profile_b_id: string; status: string; created_at: string;
    agent_a: string; cat_a: string; side_a: string;
    agent_b: string; cat_b: string; side_b: string;
  }>;

  // Get ratings received by this agent
  const ratingsResult = await db.execute({
    sql: `SELECT match_id, rating, comment, reviewer_agent_id, created_at
          FROM reviews WHERE reviewed_agent_id = ? ORDER BY created_at DESC`,
    args: [agentId],
  });
  const ratingsMap = new Map<string, { rating: number; comment: string | null; from: string }>();
  for (const row of ratingsResult.rows as unknown as Array<{
    match_id: string; rating: number; comment: string | null; reviewer_agent_id: string;
  }>) {
    ratingsMap.set(row.match_id, { rating: Number(row.rating), comment: row.comment, from: row.reviewer_agent_id });
  }

  // Get milestone stats per deal
  const dealIds = deals.map(d => d.id);
  const milestoneStats = new Map<string, { total: number; completed: number }>();
  if (dealIds.length > 0) {
    const dealPlaceholders = dealIds.map(() => "?").join(",");
    const msResult = await db.execute({
      sql: `SELECT match_id,
              COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
            FROM deal_milestones
            WHERE match_id IN (${dealPlaceholders})
            GROUP BY match_id`,
      args: dealIds,
    });
    for (const row of msResult.rows as unknown as Array<{
      match_id: string; total: number; completed: number;
    }>) {
      milestoneStats.set(row.match_id, { total: Number(row.total), completed: Number(row.completed) });
    }
  }

  // Build portfolio entries
  const completedDeals = deals.map(d => {
    const isAgentA = d.agent_a === agentId;
    const myCategory = isAgentA ? d.cat_a : d.cat_b;
    const mySide = isAgentA ? d.side_a : d.side_b;
    const counterpartAgent = isAgentA ? d.agent_b : d.agent_a;
    const rating = ratingsMap.get(d.id);
    const milestones = milestoneStats.get(d.id);

    return {
      deal_id: d.id,
      category: myCategory,
      side: mySide,
      status: d.status,
      counterpart_agent_id: counterpartAgent,
      created_at: d.created_at,
      rating_received: rating ? { rating: rating.rating, comment: rating.comment, from: rating.from } : null,
      milestones: milestones ? { total: milestones.total, completed: milestones.completed } : null,
    };
  });

  // Verified categories: categories with completed deals
  const categoryCounts = new Map<string, number>();
  for (const d of completedDeals) {
    if (d.status === "completed") {
      categoryCounts.set(d.category, (categoryCounts.get(d.category) || 0) + 1);
    }
  }

  const verifiedCategories = Array.from(categoryCounts.entries()).map(([category, count]) => ({
    category,
    completed_deals: count,
    level: count >= 10 ? "gold" : count >= 3 ? "silver" : "bronze",
  })).sort((a, b) => b.completed_deals - a.completed_deals);

  // Badges
  const badges: Array<{ id: string; name: string; description: string }> = [];
  const totalCompleted = completedDeals.filter(d => d.status === "completed").length;

  if (totalCompleted >= 1) {
    badges.push({ id: "first_deal", name: "First Deal", description: "Completed first deal on LinkedClaw" });
  }
  if (totalCompleted >= 5) {
    badges.push({ id: "prolific", name: "Prolific", description: "Completed 5+ deals" });
  }
  if (totalCompleted >= 10) {
    badges.push({ id: "veteran", name: "Veteran", description: "Completed 10+ deals" });
  }
  if (verifiedCategories.length >= 3) {
    badges.push({ id: "multi_category", name: "Multi-Category", description: "Completed deals in 3+ categories" });
  }

  // Rating-based badges
  const allRatings = completedDeals.filter(d => d.rating_received).map(d => d.rating_received!.rating);
  if (allRatings.length >= 3) {
    const avgRating = allRatings.reduce((s, r) => s + r, 0) / allRatings.length;
    if (avgRating >= 4.0) {
      badges.push({ id: "highly_rated", name: "Highly Rated", description: "Average rating of 4.0+ with 3+ reviews" });
    }
    if (avgRating >= 4.8) {
      badges.push({ id: "exceptional", name: "Exceptional", description: "Average rating of 4.8+ with 3+ reviews" });
    }
  }

  // Stats
  const avgRatingReceived = allRatings.length > 0
    ? Math.round((allRatings.reduce((s, r) => s + r, 0) / allRatings.length) * 100) / 100
    : 0;

  return NextResponse.json({
    agent_id: agentId,
    completed_deals: completedDeals,
    verified_categories: verifiedCategories,
    badges,
    stats: {
      total_completed: totalCompleted,
      total_in_progress: completedDeals.filter(d => d.status === "in_progress").length,
      categories_worked: verifiedCategories.length,
      avg_rating_received: avgRatingReceived,
      total_ratings: allRatings.length,
    },
  });
}
