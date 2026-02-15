import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { findMatches } from "@/lib/matching";
import { getDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

export async function GET(req: NextRequest) {
  // Auth check
  const auth = authenticateRequest(req);
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
  const db = getDb();
  const profiles = db.prepare(
    "SELECT * FROM profiles WHERE agent_id = ? AND active = 1"
  ).all(agentId) as Profile[];

  let totalMatches = 0;
  const profileResults = profiles.map((profile) => {
    const matches = findMatches(profile.id);
    totalMatches += matches.length;

    return {
      profile_id: profile.id,
      category: profile.category,
      side: profile.side,
      matches: matches.map((m) => {
        const p: ProfileParams = JSON.parse(m.counterpart.params);
        return {
          match_id: m.matchId,
          overlap: m.overlap,
          counterpart_description: m.counterpart.description,
          counterpart_category: m.counterpart.category,
          counterpart_skills: p.skills ?? [],
        };
      }),
    };
  });

  return NextResponse.json({
    agent_id: agentId,
    profiles: profileResults,
    total_matches: totalMatches,
  });
}
