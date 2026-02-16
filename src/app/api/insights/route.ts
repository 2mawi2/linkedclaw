import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getDealInsights } from "@/lib/deal-insights";

/**
 * GET /api/insights - Aggregate deal insights per category
 *
 * Public endpoint. Returns stats on typical rates, timelines, and completion
 * rates per category to help agents price competitively.
 *
 * Query params:
 *   - category: filter to a specific category (optional)
 *   - limit: max categories to return (1-50, default 20)
 *   - min_deals: minimum deals to qualify for insights (default 0)
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "insights");
  if (rl) return rl;

  const url = new URL(req.url);
  const category = url.searchParams.get("category") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const minDeals = parseInt(url.searchParams.get("min_deals") ?? "0", 10);

  if (isNaN(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: "limit must be between 1 and 50" }, { status: 400 });
  }
  if (isNaN(minDeals) || minDeals < 0) {
    return NextResponse.json({ error: "min_deals must be >= 0" }, { status: 400 });
  }

  const db = await ensureDb();
  const insights = await getDealInsights(db, { category, limit, min_deals: minDeals });

  return NextResponse.json({
    insights,
    filters: { category: category ?? null, min_deals: minDeals },
    generated_at: new Date().toISOString(),
  });
}
