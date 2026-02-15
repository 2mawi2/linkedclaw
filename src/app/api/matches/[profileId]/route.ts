import { NextRequest, NextResponse } from "next/server";
import { findMatches } from "@/lib/matching";
import { ensureDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
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

  // Look up counterpart reputations
  const counterpartAgentIds = [...new Set(matches.map(m => m.counterpart.agent_id))];
  const reputationMap: Record<string, { avg_rating: number; total_reviews: number }> = {};
  for (const aid of counterpartAgentIds) {
    const rr = await db.execute({
      sql: `SELECT COUNT(*) as total_reviews, COALESCE(AVG(rating * 1.0), 0) as avg_rating
            FROM reviews WHERE reviewed_agent_id = ?`,
      args: [aid],
    });
    const row = rr.rows[0] as unknown as { total_reviews: number; avg_rating: number };
    const t = Number(row.total_reviews);
    reputationMap[aid] = {
      avg_rating: t > 0 ? Math.round(Number(row.avg_rating) * 100) / 100 : 0,
      total_reviews: t,
    };
  }

  return NextResponse.json({
    matches: matches.map(m => {
      const p: ProfileParams = JSON.parse(m.counterpart.params);
      const overlap = typeof m.overlap === 'string' ? JSON.parse(m.overlap) : m.overlap;
      return {
        match_id: m.matchId,
        score: overlap?.score ?? null,
        overlap,
        counterpart_agent_id: m.counterpart.agent_id,
        counterpart_description: m.counterpart.description,
        counterpart_category: m.counterpart.category,
        counterpart_skills: p.skills ?? [],
        counterpart_reputation: reputationMap[m.counterpart.agent_id] ?? { avg_rating: 0, total_reviews: 0 },
      };
    }),
  });
}
