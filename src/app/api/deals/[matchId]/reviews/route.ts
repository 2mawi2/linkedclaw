import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/deals/:matchId/reviews
 * Public endpoint - returns all reviews for a specific deal.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const { matchId } = await params;

  if (!matchId || matchId.trim().length === 0) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Verify match exists
  const matchResult = await db.execute({
    sql: "SELECT id FROM matches WHERE id = ?",
    args: [matchId],
  });
  if (matchResult.rows.length === 0) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const reviewsResult = await db.execute({
    sql: `SELECT id, reviewer_agent_id, reviewed_agent_id, rating, comment, created_at
          FROM reviews WHERE match_id = ?
          ORDER BY created_at DESC`,
    args: [matchId],
  });

  const reviews = reviewsResult.rows.map((r) => ({
    id: r.id as string,
    reviewer_agent_id: r.reviewer_agent_id as string,
    reviewed_agent_id: r.reviewed_agent_id as string,
    rating: Number(r.rating),
    comment: r.comment as string | null,
    created_at: r.created_at as string,
  }));

  return NextResponse.json({ match_id: matchId, reviews });
}
