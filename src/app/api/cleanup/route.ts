import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredDeals, cleanupInactiveProfiles } from "@/lib/cleanup";
import { withWriteRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/cleanup - Run housekeeping tasks.
 * Intended to be called by a cron job or admin trigger.
 */
export async function POST(req: NextRequest) {
  const rateLimited = withWriteRateLimit(req);
  if (rateLimited) return rateLimited;
  const expired_deals = cleanupExpiredDeals();
  const deactivated_profiles = cleanupInactiveProfiles(30);

  return NextResponse.json({ expired_deals, deactivated_profiles });
}
