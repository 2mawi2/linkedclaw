import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import type { Match, Profile } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "evidence-get");
  if (rl) return rl;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await params;
  const db = await ensureDb();

  // Verify deal exists and user is participant
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const profileA = (
    await db.execute({ sql: "SELECT * FROM profiles WHERE id = ?", args: [match.profile_a_id] })
  ).rows[0] as unknown as Profile;
  const profileB = (
    await db.execute({ sql: "SELECT * FROM profiles WHERE id = ?", args: [match.profile_b_id] })
  ).rows[0] as unknown as Profile;

  if (profileA.agent_id !== auth.agent_id && profileB.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Not a participant in this deal" }, { status: 403 });
  }

  const completions = await db.execute({
    sql: "SELECT agent_id, evidence, created_at FROM deal_completions WHERE match_id = ? ORDER BY created_at",
    args: [matchId],
  });

  return NextResponse.json({
    match_id: matchId,
    status: match.status,
    completions: completions.rows,
    both_confirmed: completions.rows.length >= 2,
  });
}
