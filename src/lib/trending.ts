import { Client } from "@libsql/client";

export interface TrendingCategory {
  category: string;
  new_listings_7d: number;
  new_listings_30d: number;
  deals_closed_7d: number;
  deals_closed_30d: number;
  avg_close_time_hours: number | null;
  growth_rate: number; // % change in listings (7d vs prior 7d)
  trend_score: number; // composite score for ranking
}

/**
 * Compute trending categories based on recent activity signals.
 *
 * Trend score = weighted composite:
 *   - New listings (7d): 3x weight
 *   - Deals closed (7d): 5x weight
 *   - Growth rate: 2x weight
 *   - Fast close time bonus: 1x weight
 */
export async function getTrendingCategories(
  db: Client,
  options: { limit?: number; min_listings?: number } = {},
): Promise<TrendingCategory[]> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const minListings = options.min_listings ?? 0;

  // New listings in last 7 days per category
  const listings7d = await db.execute(
    `SELECT category, COUNT(*) as cnt
     FROM profiles
     WHERE active = 1 AND created_at >= datetime('now', '-7 days')
     GROUP BY category`,
  );

  // New listings in last 30 days per category
  const listings30d = await db.execute(
    `SELECT category, COUNT(*) as cnt
     FROM profiles
     WHERE active = 1 AND created_at >= datetime('now', '-30 days')
     GROUP BY category`,
  );

  // New listings in prior 7 days (8-14 days ago) for growth rate
  const listingsPrior7d = await db.execute(
    `SELECT category, COUNT(*) as cnt
     FROM profiles
     WHERE active = 1
       AND created_at >= datetime('now', '-14 days')
       AND created_at < datetime('now', '-7 days')
     GROUP BY category`,
  );

  // Deals closed in last 7 days
  const deals7d = await db.execute(
    `SELECT p.category, COUNT(DISTINCT m.id) as cnt
     FROM matches m
     JOIN profiles p ON p.id = m.profile_a_id
     WHERE m.status IN ('approved', 'completed', 'in_progress')
       AND m.created_at >= datetime('now', '-7 days')
     GROUP BY p.category`,
  );

  // Deals closed in last 30 days
  const deals30d = await db.execute(
    `SELECT p.category, COUNT(DISTINCT m.id) as cnt
     FROM matches m
     JOIN profiles p ON p.id = m.profile_a_id
     WHERE m.status IN ('approved', 'completed', 'in_progress')
       AND m.created_at >= datetime('now', '-30 days')
     GROUP BY p.category`,
  );

  // Average close time per category (estimated from deal events if available, else skip)
  // Use deal_events table if it exists, otherwise return null for close times
  let closeMap = new Map<string, number | null>();
  try {
    const avgClose = await db.execute(
      `SELECT p.category,
         AVG(
           (julianday(de.created_at) - julianday(m.created_at)) * 24
         ) as avg_hours
       FROM matches m
       JOIN profiles p ON p.id = m.profile_a_id
       JOIN deal_events de ON de.match_id = m.id AND de.event_type = 'approved'
       WHERE m.status IN ('approved', 'completed', 'in_progress')
         AND m.created_at >= datetime('now', '-30 days')
       GROUP BY p.category`,
    );
    closeMap = new Map(
      (avgClose.rows as any[]).map((r) => [
        r.category as string,
        r.avg_hours != null ? Number(r.avg_hours) : null,
      ]),
    );
  } catch {
    // deal_events table may not exist - close times will be null
  }

  // Build maps
  const toMap = (rows: any[]) => new Map(rows.map((r) => [r.category as string, Number(r.cnt)]));
  const l7d = toMap(listings7d.rows as any[]);
  const l30d = toMap(listings30d.rows as any[]);
  const lPrior = toMap(listingsPrior7d.rows as any[]);
  const d7d = toMap(deals7d.rows as any[]);
  const d30d = toMap(deals30d.rows as any[]);
  // Collect all categories
  const allCategories = new Set([...l7d.keys(), ...l30d.keys(), ...d7d.keys(), ...d30d.keys()]);

  const results: TrendingCategory[] = [];

  for (const cat of allCategories) {
    const newL7 = l7d.get(cat) ?? 0;
    const newL30 = l30d.get(cat) ?? 0;
    const prior7 = lPrior.get(cat) ?? 0;
    const closed7 = d7d.get(cat) ?? 0;
    const closed30 = d30d.get(cat) ?? 0;
    const avgHours = closeMap.get(cat) ?? null;

    if (newL30 < minListings) continue;

    // Growth rate: % change from prior 7d to current 7d
    const growthRate =
      prior7 === 0 ? (newL7 > 0 ? 100 : 0) : Math.round(((newL7 - prior7) / prior7) * 100);

    // Close time bonus: faster = higher score (cap at 168h = 1 week)
    const closeBonus =
      avgHours != null && avgHours > 0 ? Math.max(0, 10 - Math.min(avgHours / 16.8, 10)) : 0;

    // Composite trend score
    const trendScore = Math.round(
      newL7 * 3 + closed7 * 5 + Math.max(growthRate, 0) * 0.2 + closeBonus,
    );

    results.push({
      category: cat,
      new_listings_7d: newL7,
      new_listings_30d: newL30,
      deals_closed_7d: closed7,
      deals_closed_30d: closed30,
      avg_close_time_hours: avgHours != null ? Math.round(avgHours * 10) / 10 : null,
      growth_rate: growthRate,
      trend_score: trendScore,
    });
  }

  // Sort by trend_score descending
  results.sort((a, b) => b.trend_score - a.trend_score);

  return results.slice(0, limit);
}
