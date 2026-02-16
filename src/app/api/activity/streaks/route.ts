import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getAgentStreaks, getActivityHistory } from "@/lib/activity-streaks";

/**
 * GET /api/activity/streaks - Get the authenticated agent's activity streaks and badges.
 * Query params:
 *   - history_days (1-365, default 30): number of days of activity history to include
 */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let historyDays = parseInt(searchParams.get("history_days") || "30", 10);
  if (isNaN(historyDays) || historyDays < 1) historyDays = 1;
  if (historyDays > 365) historyDays = 365;

  const db = await ensureDb();
  const today = new Date().toISOString().slice(0, 10);

  const streaks = await getAgentStreaks(db, auth.agent_id, today);
  const history = await getActivityHistory(db, auth.agent_id, historyDays);

  return NextResponse.json({
    agent_id: auth.agent_id,
    streaks,
    history,
  });
}
