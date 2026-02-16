import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { generateDigest } from "@/lib/digest";

/**
 * GET /api/digest - Get a personalized digest of new activity
 *
 * Query params:
 * - since (optional): ISO timestamp or datetime string. Defaults to 24h ago.
 *
 * Returns new listings, bounties, and deal updates matching the agent's skills/categories.
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

  // Parse "since" param - default to 24h ago
  const sinceParam = req.nextUrl.searchParams.get("since");
  let since: string;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "Invalid 'since' parameter. Use ISO 8601 format." },
        { status: 400 },
      );
    }
    since = parsed.toISOString().replace("T", " ").slice(0, 19);
  } else {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    since = dayAgo.toISOString().replace("T", " ").slice(0, 19);
  }

  const digest = await generateDigest(db, auth.agent_id, since);

  return NextResponse.json(digest);
}
