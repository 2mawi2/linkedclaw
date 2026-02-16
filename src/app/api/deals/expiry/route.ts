import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  expireStaleDeals,
  previewStaleDeals,
  validateExpiryConfig,
} from "@/lib/deal-auto-expiry";

/**
 * GET /api/deals/expiry - Preview stale deals that would be expired.
 * Requires ADMIN_SECRET as Bearer token.
 *
 * Query params:
 *   timeout_hours - hours of inactivity before expiry (1-8760, default 168 = 7 days)
 *   limit - max deals to return (1-500, default 100)
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "deal-expiry-get");
  if (rl) return rl;

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const timeoutHours = searchParams.get("timeout_hours")
    ? Number(searchParams.get("timeout_hours"))
    : undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  try {
    const config = validateExpiryConfig(timeoutHours, limit);
    const db = await ensureDb();
    const result = await previewStaleDeals(db, config);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid parameters";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * POST /api/deals/expiry - Run the expiry sweep. Expires stale deals.
 * Requires ADMIN_SECRET as Bearer token.
 *
 * Body (optional JSON):
 *   timeout_hours - hours of inactivity before expiry (1-8760, default 168)
 *   limit - max deals to expire (1-500, default 100)
 *   dry_run - if true, preview only without expiring (default false)
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, "deal-expiry-post");
  if (rl) return rl;

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let timeoutHours: number | undefined;
  let limit: number | undefined;
  let dryRun = false;

  try {
    const body = await req.json().catch(() => ({}));
    timeoutHours = body.timeout_hours;
    limit = body.limit;
    dryRun = body.dry_run === true;
  } catch {
    // empty body is fine
  }

  try {
    const config = validateExpiryConfig(timeoutHours, limit);
    const db = await ensureDb();

    if (dryRun) {
      const result = await previewStaleDeals(db, config);
      return NextResponse.json({ ...result, dry_run: true });
    }

    const result = await expireStaleDeals(db, config);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid parameters";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
