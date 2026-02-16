import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureDb } from "@/lib/db";
import type { ProfileParams } from "@/lib/types";

/**
 * GET /api/market/:category - Market rate insights for a category
 *
 * Public endpoint (no auth required).
 * Returns anonymized aggregate data: rate percentiles, top skills,
 * demand ratio, active profile count, and deal activity.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ category: string }> },
) {
  const rl = checkRateLimit(_req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "market");
  if (rl) return rl;
  const { category } = await params;
  const db = await ensureDb();

  // Get all active profiles in this category
  const profilesResult = await db.execute({
    sql: `SELECT side, params FROM profiles WHERE category = ? AND active = 1`,
    args: [category],
  });

  const profiles = profilesResult.rows as unknown as { side: string; params: string }[];

  if (profiles.length === 0) {
    return NextResponse.json({ error: "No active profiles in this category" }, { status: 404 });
  }

  // Parse rate data from all profiles
  const rates: number[] = [];
  const currencies = new Map<string, number>();
  const skillCounts = new Map<string, number>();
  let offeringCount = 0;
  let seekingCount = 0;

  for (const p of profiles) {
    if (p.side === "offering") offeringCount++;
    else seekingCount++;

    let parsed: ProfileParams;
    try {
      parsed = JSON.parse(p.params);
    } catch {
      continue;
    }

    // Collect rates (use midpoint of range if both specified)
    if (parsed.rate_min != null || parsed.rate_max != null) {
      if (parsed.rate_min != null && parsed.rate_max != null) {
        rates.push((parsed.rate_min + parsed.rate_max) / 2);
      } else if (parsed.rate_min != null) {
        rates.push(parsed.rate_min);
      } else if (parsed.rate_max != null) {
        rates.push(parsed.rate_max);
      }
    }

    // Track currency usage
    if (parsed.currency) {
      currencies.set(parsed.currency, (currencies.get(parsed.currency) ?? 0) + 1);
    }

    // Count skills
    if (parsed.skills) {
      for (const skill of parsed.skills) {
        const s = skill.toLowerCase();
        skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
      }
    }
  }

  // Compute rate percentiles
  rates.sort((a, b) => a - b);
  const rateStats =
    rates.length > 0
      ? {
          rate_median: percentile(rates, 50),
          rate_p10: percentile(rates, 10),
          rate_p90: percentile(rates, 90),
          rate_count: rates.length,
        }
      : null;

  // Most common currency
  const primaryCurrency =
    currencies.size > 0 ? [...currencies.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

  // Top skills (up to 10)
  const topSkills = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }));

  // Deal activity in this category (last 90 days)
  const dealsResult = await db.execute({
    sql: `SELECT m.status, COUNT(*) as count
      FROM matches m
      JOIN profiles p ON p.id = m.profile_a_id
      WHERE p.category = ?
        AND m.created_at >= datetime('now', '-90 days')
      GROUP BY m.status`,
    args: [category],
  });

  const dealsByStatus = Object.fromEntries(
    (dealsResult.rows as unknown as { status: string; count: number }[]).map((r) => [
      r.status,
      Number(r.count),
    ]),
  );

  const completedDeals =
    (dealsByStatus["completed"] ?? 0) +
    (dealsByStatus["approved"] ?? 0) +
    (dealsByStatus["in_progress"] ?? 0);
  const totalDeals = Object.values(dealsByStatus).reduce((a, b) => a + b, 0);

  // Demand ratio: seekers / offerers (>1 means more demand than supply)
  const demandRatio =
    offeringCount > 0
      ? Math.round((seekingCount / offeringCount) * 100) / 100
      : seekingCount > 0
        ? Infinity
        : 0;

  return NextResponse.json({
    category,
    active_profiles: profiles.length,
    offering_count: offeringCount,
    seeking_count: seekingCount,
    demand_ratio: demandRatio,
    ...(rateStats ?? {}),
    currency: primaryCurrency,
    top_skills: topSkills,
    deals_90d: {
      total: totalDeals,
      successful: completedDeals,
      by_status: dealsByStatus,
    },
  });
}

/** Compute percentile using linear interpolation. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return Math.round((sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)) * 100) / 100;
}
