import { NextRequest, NextResponse } from "next/server";
import { findMatches } from "@/lib/matching";
import { ensureDb } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Profile, ProfileParams } from "@/lib/types";
import { computeReputationScore } from "@/lib/reputation";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const rl = checkRateLimit(_req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "matches");
  if (rl) return rl;
  const { profileId } = await params;

  if (!profileId || profileId.trim().length === 0) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const profileResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
    args: [profileId],
  });
  const profile = profileResult.rows[0] as unknown as Profile | undefined;
  if (!profile) {
    return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });
  }

  const matches = await findMatches(profileId);

  // Look up counterpart reputations with composite scores
  const counterpartAgentIds = [...new Set(matches.map((m) => m.counterpart.agent_id))];
  const reputationMap: Record<
    string,
    { avg_rating: number; total_reviews: number; reputation_score: number; reputation_level: string }
  > = {};
  for (const aid of counterpartAgentIds) {
    const rr = await db.execute({
      sql: `SELECT COUNT(*) as total_reviews, COALESCE(AVG(rating * 1.0), 0) as avg_rating
            FROM reviews WHERE reviewed_agent_id = ?`,
      args: [aid],
    });
    const row = rr.rows[0] as unknown as { total_reviews: number; avg_rating: number };
    const t = Number(row.total_reviews);
    const avgR = t > 0 ? Math.round(Number(row.avg_rating) * 100) / 100 : 0;

    // Get deal stats for this agent
    const pResult = await db.execute({
      sql: `SELECT id FROM profiles WHERE agent_id = ?`,
      args: [aid],
    });
    const pIds = (pResult.rows as unknown as Array<{ id: string }>).map((p) => p.id);
    let completed = 0;
    let resolved = 0;
    if (pIds.length > 0) {
      const ph = pIds.map(() => "?").join(",");
      const ds = await db.execute({
        sql: `SELECT
                SUM(CASE WHEN status IN ('approved','completed','in_progress') THEN 1 ELSE 0 END) as c,
                SUM(CASE WHEN status IN ('approved','completed','in_progress','rejected','expired') THEN 1 ELSE 0 END) as r
              FROM matches WHERE profile_a_id IN (${ph}) OR profile_b_id IN (${ph})`,
        args: [...pIds, ...pIds],
      });
      completed = Number((ds.rows[0] as unknown as { c: number }).c) || 0;
      resolved = Number((ds.rows[0] as unknown as { r: number }).r) || 0;
    }

    const score = computeReputationScore({
      avg_rating: avgR,
      total_reviews: t,
      completed_deals: completed,
      total_resolved_deals: resolved,
    });

    reputationMap[aid] = {
      avg_rating: avgR,
      total_reviews: t,
      reputation_score: score.score,
      reputation_level: score.level,
    };
  }

  return NextResponse.json({
    matches: matches.map((m) => {
      const p: ProfileParams = JSON.parse(m.counterpart.params);
      const overlap = typeof m.overlap === "string" ? JSON.parse(m.overlap) : m.overlap;
      return {
        match_id: m.matchId,
        score: overlap?.score ?? null,
        overlap,
        counterpart_agent_id: m.counterpart.agent_id,
        counterpart_description: m.counterpart.description,
        counterpart_category: m.counterpart.category,
        counterpart_skills: p.skills ?? [],
        counterpart_reputation: reputationMap[m.counterpart.agent_id] ?? {
          avg_rating: 0,
          total_reviews: 0,
          reputation_score: 0,
          reputation_level: "unrated",
        },
      };
    }),
  });
}
