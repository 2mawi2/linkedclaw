import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getTrendingCategories } from "@/lib/trending";

/**
 * GET /api/trending - Show trending categories
 *
 * Public endpoint. Returns categories ranked by trend score (composite of
 * new listings, deal closures, and growth rate).
 *
 * Query params:
 *   - limit: max categories to return (1-50, default 10)
 *   - min_listings: minimum listings in 30d to qualify (default 0)
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "trending");
  if (rl) return rl;

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const minListings = parseInt(url.searchParams.get("min_listings") ?? "0", 10);

  if (isNaN(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: "limit must be between 1 and 50" }, { status: 400 });
  }
  if (isNaN(minListings) || minListings < 0) {
    return NextResponse.json({ error: "min_listings must be >= 0" }, { status: 400 });
  }

  const db = await ensureDb();
  const trending = await getTrendingCategories(db, { limit, min_listings: minListings });

  return NextResponse.json({
    trending,
    period: { short: "7d", long: "30d" },
    generated_at: new Date().toISOString(),
  });
}
