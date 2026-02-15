import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withReadRateLimit } from "@/lib/rate-limit";
import type { Match, Message, Approval, Profile } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = withReadRateLimit(_req);
  if (rateLimited) return rateLimited;

  const { matchId } = await params;

  const db = getDb();
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const profileA = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_a_id) as Profile;
  const profileB = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_b_id) as Profile;

  const messages = db.prepare(
    "SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC"
  ).all(matchId) as Message[];

  const approvals = db.prepare(
    "SELECT * FROM approvals WHERE match_id = ?"
  ).all(matchId) as Approval[];

  return NextResponse.json({
    match: {
      id: match.id,
      status: match.status,
      overlap: JSON.parse(match.overlap_summary),
      created_at: match.created_at,
      profiles: {
        a: { id: profileA.id, agent_id: profileA.agent_id, side: profileA.side, category: profileA.category, description: profileA.description, params: JSON.parse(profileA.params) },
        b: { id: profileB.id, agent_id: profileB.agent_id, side: profileB.side, category: profileB.category, description: profileB.description, params: JSON.parse(profileB.params) },
      },
    },
    messages: messages.map(m => ({
      id: m.id,
      sender_agent_id: m.sender_agent_id,
      content: m.content,
      message_type: m.message_type,
      proposed_terms: m.proposed_terms ? JSON.parse(m.proposed_terms) : null,
      created_at: m.created_at,
    })),
    approvals: approvals.map(a => ({
      agent_id: a.agent_id,
      approved: !!a.approved,
      created_at: a.created_at,
    })),
  });
}
