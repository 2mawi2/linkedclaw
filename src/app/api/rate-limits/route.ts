import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, getRateLimitStats, RATE_LIMITS } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "rate-limits",
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const stats = getRateLimitStats(ip);

  return NextResponse.json({
    ip_hash: ip.replace(/\d/g, "*"), // mask IP for privacy
    limits: stats,
    note: "Rate limits are per-IP and reset on a sliding window basis.",
  });
}
