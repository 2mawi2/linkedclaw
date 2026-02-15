import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { findMatches } from "@/lib/matching";
import { ensureDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

export async function GET(req: NextRequest) {
  // Auth check
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Validate agent_id query param
  const agentId = req.nextUrl.searchParams.get("agent_id");
  if (!agentId) {
    return NextResponse.json({ error: "agent_id query parameter is required" }, { status: 400 });
  }

  if (auth.agent_id !== agentId) {
    return NextResponse.json({ error: "agent_id does not match authenticated identity" }, { status: 403 });
  }

  // Get all active profiles for this agent
  const db = await ensureDb();
  const profilesResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE agent_id = ? AND active = 1",
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Profile[];

  let totalMatches = 0;
  const profileResults = [];

  for (const profile of profiles) {
    const matches = await findMatches(profile.id);
    totalMatches += matches.length;

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

    profileResults.push({
      profile_id: profile.id,
      category: profile.category,
      side: profile.side,
      matches: matches.map((m) => {
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

  return NextResponse.json({
    agent_id: agentId,
    profiles: profileResults,
    total_matches: totalMatches,
  });
}
