import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/profiles/:profileId/analytics - Get listing analytics
 *
 * Returns views, matches, and inquiries counts for a specific listing.
 * Requires authentication and the listing must belong to the authenticated agent.
 *
 * Query params:
 *   days - number of days to look back (default 30, max 365)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "profile_analytics",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { profileId } = await params;
  const db = await ensureDb();

  // Verify profile exists and belongs to the authenticated agent
  const profileResult = await db.execute({
    sql: "SELECT agent_id FROM profiles WHERE id = ?",
    args: [profileId],
  });
  const profile = profileResult.rows[0] as unknown as { agent_id: string } | undefined;
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  if (profile.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Not your listing" }, { status: 403 });
  }

  const daysParam = req.nextUrl.searchParams.get("days");
  const days = Math.min(Math.max(parseInt(daysParam || "30", 10) || 30, 1), 365);

  // Aggregate event counts
  const countsResult = await db.execute({
    sql: `SELECT event_type, COUNT(*) as count
          FROM listing_events
          WHERE profile_id = ? AND created_at >= datetime('now', ?)
          GROUP BY event_type`,
    args: [profileId, `-${days} days`],
  });
  const counts: Record<string, number> = { view: 0, match: 0, inquiry: 0 };
  for (const row of countsResult.rows) {
    counts[row.event_type as string] = Number(row.count);
  }

  // Daily breakdown over the period
  const dailyResult = await db.execute({
    sql: `SELECT date(created_at) as day, event_type, COUNT(*) as count
          FROM listing_events
          WHERE profile_id = ? AND created_at >= datetime('now', ?)
          GROUP BY day, event_type
          ORDER BY day`,
    args: [profileId, `-${days} days`],
  });
  const daily: Record<string, Record<string, number>> = {};
  for (const row of dailyResult.rows) {
    const day = row.day as string;
    if (!daily[day]) daily[day] = { view: 0, match: 0, inquiry: 0 };
    daily[day][row.event_type as string] = Number(row.count);
  }

  // Unique viewers
  const uniqueResult = await db.execute({
    sql: `SELECT COUNT(DISTINCT viewer_agent_id) as unique_viewers
          FROM listing_events
          WHERE profile_id = ? AND event_type = 'view' AND viewer_agent_id IS NOT NULL
            AND created_at >= datetime('now', ?)`,
    args: [profileId, `-${days} days`],
  });
  const uniqueViewers = Number(
    (uniqueResult.rows[0] as unknown as { unique_viewers: number }).unique_viewers,
  );

  return NextResponse.json({
    profile_id: profileId,
    period_days: days,
    totals: counts,
    unique_viewers: uniqueViewers,
    daily: Object.entries(daily).map(([day, c]) => ({ day, ...c })),
  });
}

/**
 * POST /api/profiles/:profileId/analytics - Record a listing event
 *
 * Body: { event_type: "view" | "match" | "inquiry", viewer_agent_id?: string }
 * Used internally to track when listings are viewed, matched, or inquired about.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    "profile_analytics_write",
  );
  if (rl) return rl;

  const { profileId } = await params;
  const db = await ensureDb();

  // Verify profile exists
  const profileResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE id = ?",
    args: [profileId],
  });
  if (profileResult.rows.length === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: { event_type?: string; viewer_agent_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validTypes = ["view", "match", "inquiry"];
  if (!body.event_type || !validTypes.includes(body.event_type)) {
    return NextResponse.json(
      { error: `event_type must be one of: ${validTypes.join(", ")}` },
      { status: 400 },
    );
  }

  await db.execute({
    sql: `INSERT INTO listing_events (profile_id, event_type, viewer_agent_id)
          VALUES (?, ?, ?)`,
    args: [profileId, body.event_type, body.viewer_agent_id || null],
  });

  return NextResponse.json({ ok: true });
}
