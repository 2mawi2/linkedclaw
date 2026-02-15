import { NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

/**
 * GET /api/categories - Discover active categories with profile counts
 * 
 * Public endpoint (no auth required).
 * Returns categories with offering/seeking counts and recent deal activity.
 */
export async function GET() {
  const db = await ensureDb();

  const categoriesResult = await db.execute(
    `SELECT 
      category,
      SUM(CASE WHEN side = 'offering' THEN 1 ELSE 0 END) as offering_count,
      SUM(CASE WHEN side = 'seeking' THEN 1 ELSE 0 END) as seeking_count
    FROM profiles 
    WHERE active = 1
    GROUP BY category
    ORDER BY COUNT(*) DESC`
  );

  const categories = categoriesResult.rows as unknown as { category: string; offering_count: number; seeking_count: number }[];

  // Get recent deals (last 30 days) per category
  const recentDealsResult = await db.execute(
    `SELECT p.category, COUNT(DISTINCT m.id) as deal_count
    FROM matches m
    JOIN profiles p ON p.id = m.profile_a_id
    WHERE m.status = 'approved'
      AND m.created_at >= datetime('now', '-30 days')
    GROUP BY p.category`
  );

  const recentDeals = recentDealsResult.rows as unknown as { category: string; deal_count: number }[];
  const dealMap = new Map(recentDeals.map(d => [d.category, d.deal_count]));

  return NextResponse.json({
    categories: categories.map(c => ({
      name: c.category,
      offering_count: c.offering_count,
      seeking_count: c.seeking_count,
      recent_deals: dealMap.get(c.category) ?? 0,
    })),
  });
}
