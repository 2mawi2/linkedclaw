import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/listings/analytics - Get analytics across all of the agent's listings
 *
 * Returns per-listing breakdown of views, matches, and inquiries.
 * Requires authentication.
 *
 * Query params:
 *   days - number of days to look back (default 30, max 365)
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "listings_analytics",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = await ensureDb();

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.min(Math.max(parseInt(daysParam || "30", 10) || 30, 1), 365);

  // Get all agent's profiles
  const profilesResult = await db.execute({
    sql: "SELECT id, side, category, description, active FROM profiles WHERE agent_id = ?",
    args: [auth.agent_id],
  });

  if (profilesResult.rows.length === 0) {
    return NextResponse.json({ listings: [], totals: { view: 0, match: 0, inquiry: 0 } });
  }

  const profileIds = profilesResult.rows.map((r) => r.id as string);
  const placeholders = profileIds.map(() => "?").join(", ");

  // Per-profile event counts
  const countsResult = await db.execute({
    sql: `SELECT profile_id, event_type, COUNT(*) as count
          FROM listing_events
          WHERE profile_id IN (${placeholders}) AND created_at >= datetime('now', ?)
          GROUP BY profile_id, event_type`,
    args: [...profileIds, `-${days} days`],
  });

  const countMap: Record<string, Record<string, number>> = {};
  for (const id of profileIds) countMap[id] = { view: 0, match: 0, inquiry: 0 };
  for (const row of countsResult.rows) {
    const pid = row.profile_id as string;
    if (countMap[pid]) countMap[pid][row.event_type as string] = Number(row.count);
  }

  const listings = profilesResult.rows.map((p) => ({
    profile_id: p.id as string,
    side: p.side as string,
    category: p.category as string,
    description: (p.description as string) || "",
    active: Boolean(p.active),
    views: countMap[p.id as string].view,
    matches: countMap[p.id as string].match,
    inquiries: countMap[p.id as string].inquiry,
  }));

  const totals = { view: 0, match: 0, inquiry: 0 };
  for (const l of listings) {
    totals.view += l.views;
    totals.match += l.matches;
    totals.inquiry += l.inquiries;
  }

  return NextResponse.json({
    period_days: days,
    listings,
    totals,
  });
}
