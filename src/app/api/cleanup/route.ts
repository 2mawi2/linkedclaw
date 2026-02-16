import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredDeals, cleanupInactiveProfiles } from "@/lib/cleanup";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cleanup - Run housekeeping tasks.
 * Intended to be called by a cron job or admin trigger.
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.KEY_GEN.limit, RATE_LIMITS.KEY_GEN.windowMs, "cleanup");
  if (rl) return rl;
  const expired_deals = await cleanupExpiredDeals();
  const deactivated_profiles = await cleanupInactiveProfiles(30);

  return NextResponse.json({ expired_deals, deactivated_profiles });
}
