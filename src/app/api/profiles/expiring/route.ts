import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  getExpiringListings,
  expireStaleListings,
  EXPIRY_WARNING_DAYS,
} from "@/lib/listing-expiry";

/**
 * GET /api/profiles/expiring - List the authenticated agent's listings expiring soon
 * Query: ?days=7 (default 7)
 * Also runs expiry sweep to deactivate past-due listings.
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

  const db = await ensureDb();

  // Run expiry sweep (lightweight, idempotent)
  const expiredCount = await expireStaleListings(db);

  const { searchParams } = new URL(req.url);
  const days = Math.min(
    Math.max(
      parseInt(searchParams.get("days") ?? String(EXPIRY_WARNING_DAYS), 10) || EXPIRY_WARNING_DAYS,
      1,
    ),
    90,
  );

  const expiring = await getExpiringListings(db, days);

  // Filter to only this agent's listings
  const agentExpiring = expiring.filter((l) => l.agent_id === auth.agent_id);

  return NextResponse.json({
    expiring: agentExpiring,
    expired_this_sweep: expiredCount,
    warning_days: days,
  });
}
