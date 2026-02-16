import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { computeQualityScore } from "@/lib/listing-quality";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/listings/quality - Score all of the authenticated agent's listings
 *
 * Returns quality scores for each active listing the agent owns.
 * Optionally pass ?profile_id=<id> to score a single listing.
 *
 * Response: { listings: [{ profile_id, category, side, overall_score, grade, dimensions, suggestions }] }
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "listing-quality",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = await ensureDb();
  const profileId = req.nextUrl.searchParams.get("profile_id");

  let rows: unknown[];
  if (profileId) {
    const result = await db.execute({
      sql: "SELECT * FROM profiles WHERE id = ? AND agent_id = ?",
      args: [profileId, auth.agent_id],
    });
    rows = result.rows;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Profile not found or not owned by you" }, { status: 404 });
    }
  } else {
    const result = await db.execute({
      sql: "SELECT * FROM profiles WHERE agent_id = ? AND active = 1",
      args: [auth.agent_id],
    });
    rows = result.rows;
  }

  const listings = (rows as unknown as Profile[]).map((profile) => {
    let params: ProfileParams = {};
    try {
      params = JSON.parse(profile.params) as ProfileParams;
    } catch {
      // malformed params - score with empty
    }

    const quality = computeQualityScore(profile.description, profile.category, params);

    return {
      profile_id: profile.id,
      category: profile.category,
      side: profile.side,
      overall_score: quality.overall_score,
      grade: quality.grade,
      dimensions: quality.dimensions,
      suggestions: quality.suggestions,
    };
  });

  return NextResponse.json({ listings });
}

/**
 * POST /api/listings/quality - Score a listing before creating it (preview)
 *
 * Body: { description, category, params: { skills, rate_min, rate_max, ... } }
 *
 * Public endpoint - agents can check quality before posting.
 */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "listing-quality",
  );
  if (rl) return rl;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description : null;
  const category = typeof body.category === "string" ? body.category : null;
  const params = (
    typeof body.params === "object" && body.params !== null ? body.params : {}
  ) as ProfileParams;

  const quality = computeQualityScore(description, category, params);

  return NextResponse.json(quality);
}
