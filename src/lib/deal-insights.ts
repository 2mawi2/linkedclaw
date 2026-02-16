import { Client } from "@libsql/client";

export interface CategoryInsight {
  category: string;
  total_deals: number;
  completed_deals: number;
  avg_rate_min: number | null;
  avg_rate_max: number | null;
  median_rate_min: number | null;
  median_rate_max: number | null;
  avg_time_to_close_hours: number | null;
  avg_messages_per_deal: number;
  completion_rate: number; // 0-100
  active_listings: number;
}

/**
 * Compute deal insights (aggregate stats) per category.
 * Helps agents price competitively and set realistic timelines.
 */
export async function getDealInsights(
  db: Client,
  options: { category?: string; limit?: number; min_deals?: number } = {},
): Promise<CategoryInsight[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const minDeals = options.min_deals ?? 0;

  // Get all matches with their profile category and params
  const matchRows = await db.execute(
    `SELECT m.id, m.status, m.created_at as match_created,
            p.category, p.params
     FROM matches m
     JOIN profiles p ON p.id = m.profile_a_id`,
  );

  // Get message counts per match
  const msgRows = await db.execute(
    `SELECT match_id, COUNT(*) as cnt FROM messages GROUP BY match_id`,
  );
  const msgMap = new Map(
    (msgRows.rows as unknown as { match_id: string; cnt: number }[]).map((r) => [
      r.match_id,
      Number(r.cnt),
    ]),
  );

  // Get completion timestamps (from deal_completions or approvals)
  let closeMap = new Map<string, string>();
  try {
    const completions = await db.execute(`SELECT match_id, created_at FROM deal_completions`);
    closeMap = new Map(
      (completions.rows as unknown as { match_id: string; created_at: string }[]).map((r) => [
        r.match_id,
        r.created_at,
      ]),
    );
  } catch {
    // deal_completions may not exist
  }

  // If no completion records, try approvals as close proxy
  if (closeMap.size === 0) {
    try {
      const approvals = await db.execute(
        `SELECT match_id, MAX(created_at) as created_at
         FROM approvals WHERE approved = 1
         GROUP BY match_id`,
      );
      closeMap = new Map(
        (approvals.rows as unknown as { match_id: string; created_at: string }[]).map((r) => [
          r.match_id,
          r.created_at,
        ]),
      );
    } catch {
      // approvals may not exist
    }
  }

  // Active listings per category
  const activeRows = await db.execute(
    `SELECT category, COUNT(*) as cnt FROM profiles WHERE active = 1 GROUP BY category`,
  );
  const activeMap = new Map(
    (activeRows.rows as unknown as { category: string; cnt: number }[]).map((r) => [
      r.category,
      Number(r.cnt),
    ]),
  );

  // Group matches by category
  type MatchRow = {
    id: string;
    status: string;
    match_created: string;
    category: string;
    params: string;
  };

  const catData = new Map<
    string,
    {
      total: number;
      completed: number;
      ratesMins: number[];
      ratesMaxs: number[];
      closeTimes: number[];
      msgCounts: number[];
    }
  >();

  for (const row of matchRows.rows as unknown as MatchRow[]) {
    const cat = row.category;
    if (!catData.has(cat)) {
      catData.set(cat, {
        total: 0,
        completed: 0,
        ratesMins: [],
        ratesMaxs: [],
        closeTimes: [],
        msgCounts: [],
      });
    }
    const d = catData.get(cat)!;
    d.total++;

    const isCompleted = ["approved", "completed", "in_progress"].includes(row.status);
    if (isCompleted) d.completed++;

    // Parse rate from params
    try {
      const params = JSON.parse(row.params || "{}");
      if (typeof params.rate_min === "number") d.ratesMins.push(params.rate_min);
      if (typeof params.rate_max === "number") d.ratesMaxs.push(params.rate_max);
    } catch {
      // skip bad JSON
    }

    // Message count for this deal
    const msgs = msgMap.get(row.id) ?? 0;
    d.msgCounts.push(msgs);

    // Close time
    const closeAt = closeMap.get(row.id);
    if (closeAt && row.match_created) {
      const diffMs = new Date(closeAt).getTime() - new Date(row.match_created).getTime();
      if (diffMs > 0) {
        d.closeTimes.push(diffMs / (1000 * 60 * 60)); // hours
      }
    }
  }

  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const avg = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  };

  const round1 = (v: number | null): number | null => (v != null ? Math.round(v * 10) / 10 : null);

  const results: CategoryInsight[] = [];

  for (const [cat, d] of catData) {
    if (d.total < minDeals) continue;

    results.push({
      category: cat,
      total_deals: d.total,
      completed_deals: d.completed,
      avg_rate_min: round1(avg(d.ratesMins)),
      avg_rate_max: round1(avg(d.ratesMaxs)),
      median_rate_min: round1(median(d.ratesMins)),
      median_rate_max: round1(median(d.ratesMaxs)),
      avg_time_to_close_hours: round1(avg(d.closeTimes)),
      avg_messages_per_deal: round1(avg(d.msgCounts)) ?? 0,
      completion_rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
      active_listings: activeMap.get(cat) ?? 0,
    });
  }

  // Sort by total_deals descending
  results.sort((a, b) => b.total_deals - a.total_deals);

  // Filter by category if specified
  if (options.category) {
    const filtered = results.filter(
      (r) => r.category.toLowerCase() === options.category!.toLowerCase(),
    );
    return filtered.slice(0, limit);
  }

  return results.slice(0, limit);
}
