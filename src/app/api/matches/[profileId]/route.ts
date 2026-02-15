import { NextRequest, NextResponse } from "next/server";
import { findMatches } from "@/lib/matching";
import { getDb } from "@/lib/db";
import { withReadRateLimit } from "@/lib/rate-limit";
import type { Profile, ProfileParams } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const rateLimited = withReadRateLimit(_req);
  if (rateLimited) return rateLimited;

  const { profileId } = await params;

  if (!profileId || profileId.trim().length === 0) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const db = getDb();
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ? AND active = 1").get(profileId) as Profile | undefined;
  if (!profile) {
    return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });
  }

  const matches = findMatches(profileId);

  return NextResponse.json({
    matches: matches.map(m => {
      const p: ProfileParams = JSON.parse(m.counterpart.params);
      return {
        match_id: m.matchId,
        overlap: m.overlap,
        counterpart_description: m.counterpart.description,
        counterpart_category: m.counterpart.category,
        counterpart_skills: p.skills ?? [],
      };
    }),
  });
}
