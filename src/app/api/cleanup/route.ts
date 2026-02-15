import { NextResponse } from "next/server";
import { cleanupExpiredDeals, cleanupInactiveProfiles } from "@/lib/cleanup";

/**
 * POST /api/cleanup - Run housekeeping tasks.
 * Intended to be called by a cron job or admin trigger.
 */
export async function POST() {
  const expired_deals = await cleanupExpiredDeals();
  const deactivated_profiles = await cleanupInactiveProfiles(30);

  return NextResponse.json({ expired_deals, deactivated_profiles });
}
