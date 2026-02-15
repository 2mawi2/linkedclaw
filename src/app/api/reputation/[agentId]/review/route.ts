import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

/**
 * POST /api/reputation/:agentId/review
 * Submit a review for an agent after a completed (approved) deal.
 * Auth required – reviewer must be a participant in the deal.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  if (auth.agent_id === agentId) {
    return NextResponse.json({ error: "Cannot review yourself" }, { status: 400 });
  }

  let body: { match_id?: string; rating?: number; comment?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { match_id, rating, comment } = body;

  if (!match_id || typeof match_id !== "string") {
    return NextResponse.json({ error: "match_id is required" }, { status: 400 });
  }
  if (
    rating === undefined ||
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return NextResponse.json(
      { error: "rating must be an integer between 1 and 5" },
      { status: 400 },
    );
  }
  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    return NextResponse.json({ error: "comment must be a string" }, { status: 400 });
  }

  const db = await ensureDb();

  // Check match exists and is approved
  const matchResult = await db.execute({
    sql: "SELECT id, profile_a_id, profile_b_id, status FROM matches WHERE id = ?",
    args: [match_id],
  });
  const match = matchResult.rows[0] as unknown as
    | {
        id: string;
        profile_a_id: string;
        profile_b_id: string;
        status: string;
      }
    | undefined;

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (
    match.status !== "approved" &&
    match.status !== "completed" &&
    match.status !== "in_progress"
  ) {
    return NextResponse.json(
      { error: "Reviews can only be submitted for approved, in-progress, or completed deals" },
      { status: 400 },
    );
  }

  // Verify both reviewer and reviewed agent are participants
  const participantsResult = await db.execute({
    sql: `SELECT id, agent_id FROM profiles WHERE id IN (?, ?)`,
    args: [match.profile_a_id, match.profile_b_id],
  });
  const participants = participantsResult.rows as unknown as Array<{
    id: string;
    agent_id: string;
  }>;

  const reviewerIsParticipant = participants.some((p) => p.agent_id === auth.agent_id);
  const reviewedIsParticipant = participants.some((p) => p.agent_id === agentId);

  if (!reviewerIsParticipant || !reviewedIsParticipant) {
    return NextResponse.json(
      { error: "Both reviewer and reviewed agent must be participants in this deal" },
      { status: 403 },
    );
  }

  // Check for duplicate
  const existingResult = await db.execute({
    sql: "SELECT id FROM reviews WHERE match_id = ? AND reviewer_agent_id = ?",
    args: [match_id, auth.agent_id],
  });
  if (existingResult.rows.length > 0) {
    return NextResponse.json(
      { error: "You have already submitted a review for this deal" },
      { status: 409 },
    );
  }

  const reviewId = randomUUID();
  await db.execute({
    sql: `INSERT INTO reviews (id, match_id, reviewer_agent_id, reviewed_agent_id, rating, comment)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [reviewId, match_id, auth.agent_id, agentId, rating, comment ?? null],
  });

  return NextResponse.json(
    {
      id: reviewId,
      match_id,
      reviewer_agent_id: auth.agent_id,
      reviewed_agent_id: agentId,
      rating,
      comment: comment ?? null,
    },
    { status: 201 },
  );
}
