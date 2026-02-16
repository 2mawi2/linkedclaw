import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { computeDedupScore, DEDUP_THRESHOLD } from "@/lib/listing-dedup";
import type { DedupCandidate } from "@/lib/listing-dedup";

/**
 * GET /api/listings/duplicates
 * Check an agent's active listings for near-duplicates.
 * Query params:
 *   - threshold (optional, 1-100, default 60): minimum score to flag as duplicate
 *   - profile_id (optional): check a specific listing only
 *
 * POST /api/listings/duplicates
 * Preview dedup check before creating a listing.
 * Body: { side, category, description?, params? }
 */

interface DedupPair {
  profile_id: string;
  duplicate_of: string;
  score: number;
  reasons: string[];
}

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
  const thresholdParam = searchParams.get("threshold");
  const profileId = searchParams.get("profile_id");

  let threshold = DEDUP_THRESHOLD;
  if (thresholdParam) {
    const parsed = parseInt(thresholdParam, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "threshold must be between 1 and 100" },
        { status: 400 },
      );
    }
    threshold = parsed;
  }

  const db = await ensureDb();

  // Get the agent's active listings
  const result = await db.execute({
    sql: "SELECT id, side, category, description, params, created_at FROM profiles WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC",
    args: [auth.agent_id],
  });

  const listings: (DedupCandidate & { id: string })[] = result.rows.map((r) => ({
    id: r.id as string,
    profile_id: r.id as string,
    side: r.side as string,
    category: r.category as string,
    description: (r.description as string) || null,
    params: JSON.parse((r.params as string) || "{}"),
    created_at: r.created_at as string,
  }));

  // If profile_id specified, only check that one against others
  const toCheck = profileId ? listings.filter((l) => l.id === profileId) : listings;
  if (profileId && toCheck.length === 0) {
    return NextResponse.json(
      { error: "Profile not found or not active" },
      { status: 404 },
    );
  }

  const duplicates: DedupPair[] = [];
  const seen = new Set<string>();

  for (const listing of toCheck) {
    for (const other of listings) {
      if (listing.id === other.id) continue;
      const pairKey = [listing.id, other.id].sort().join(":");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const result = computeDedupScore(listing, other);
      if (result.score >= threshold) {
        duplicates.push({
          profile_id: listing.id,
          duplicate_of: result.duplicate_of,
          score: result.score,
          reasons: result.reasons,
        });
      }
    }
  }

  return NextResponse.json({
    agent_id: auth.agent_id,
    threshold,
    total_active_listings: listings.length,
    duplicates_found: duplicates.length,
    duplicates: duplicates.sort((a, b) => b.score - a.score),
  });
}

export async function POST(req: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const side = body.side as string;
  const category = body.category as string;

  if (!side || !["offering", "seeking"].includes(side)) {
    return NextResponse.json({ error: "side must be 'offering' or 'seeking'" }, { status: 400 });
  }
  if (!category || typeof category !== "string") {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }

  const thresholdParam = body.threshold;
  let threshold = DEDUP_THRESHOLD;
  if (thresholdParam !== undefined) {
    const parsed = typeof thresholdParam === "number" ? thresholdParam : parseInt(String(thresholdParam), 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 100) {
      return NextResponse.json(
        { error: "threshold must be between 1 and 100" },
        { status: 400 },
      );
    }
    threshold = parsed;
  }

  const candidate: DedupCandidate = {
    profile_id: "preview",
    side,
    category,
    description: (body.description as string) || null,
    params: (body.params as Record<string, unknown>) || {},
    created_at: new Date().toISOString(),
  };

  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT id, side, category, description, params, created_at FROM profiles WHERE agent_id = ? AND active = 1",
    args: [auth.agent_id],
  });

  const listings: DedupCandidate[] = result.rows.map((r) => ({
    profile_id: r.id as string,
    side: r.side as string,
    category: r.category as string,
    description: (r.description as string) || null,
    params: JSON.parse((r.params as string) || "{}"),
    created_at: r.created_at as string,
  }));

  const duplicates: DedupPair[] = [];
  for (const existing of listings) {
    const res = computeDedupScore(candidate, existing);
    if (res.score >= threshold) {
      duplicates.push({
        profile_id: "preview",
        duplicate_of: res.duplicate_of,
        score: res.score,
        reasons: res.reasons,
      });
    }
  }

  return NextResponse.json({
    threshold,
    is_duplicate: duplicates.length > 0,
    duplicates_found: duplicates.length,
    duplicates: duplicates.sort((a, b) => b.score - a.score),
  });
}
