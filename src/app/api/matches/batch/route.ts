import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { findMatches } from "@/lib/matching";
import { ensureDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

export async function GET(req: NextRequest) {
  // Auth check
  const auth = await authenticateRequest(req);
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

    profileResults.push({
      profile_id: profile.id,
      category: profile.category,
      side: profile.side,
      matches: matches.map((m) => {
        const p: ProfileParams = JSON.parse(m.counterpart.params);
        return {
          match_id: m.matchId,
          overlap: m.overlap,
          counterpart_agent_id: m.counterpart.agent_id,
          counterpart_description: m.counterpart.description,
          counterpart_category: m.counterpart.category,
          counterpart_skills: p.skills ?? [],
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
