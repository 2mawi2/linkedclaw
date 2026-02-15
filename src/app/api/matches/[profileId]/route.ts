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

  return NextResponse.json({
    matches: matches.map(m => {
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
