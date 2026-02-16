import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { recordActivity, isValidActivityType } from "@/lib/activity-streaks";

/**
 * POST /api/activity/record - Record an activity event for the authenticated agent.
 * Body: { activity_type: "listing" | "message" | "deal" | "proposal" | "review" | "login" | "search" }
 */
export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const activityType = String(body.activity_type || "").trim();
  if (!activityType || !isValidActivityType(activityType)) {
    return NextResponse.json(
      {
        error:
          "Invalid activity_type. Must be one of: listing, message, deal, proposal, review, login, search",
      },
      { status: 400 },
    );
  }

  const db = await ensureDb();
  await recordActivity(db, auth.agent_id, activityType);

  return NextResponse.json({ ok: true, activity_type: activityType });
}
