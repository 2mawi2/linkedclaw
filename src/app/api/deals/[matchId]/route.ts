import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import type { Match, Message, Approval, Profile } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;

  const db = await ensureDb();
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const profileAResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [match.profile_a_id],
  });
  const profileA = profileAResult.rows[0] as unknown as Profile;

  const profileBResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [match.profile_b_id],
  });
  const profileB = profileBResult.rows[0] as unknown as Profile;

  const messagesResult = await db.execute({
    sql: "SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC",
    args: [matchId],
  });
  const messages = messagesResult.rows as unknown as Message[];

  const approvalsResult = await db.execute({
    sql: "SELECT * FROM approvals WHERE match_id = ?",
    args: [matchId],
  });
  const approvals = approvalsResult.rows as unknown as Approval[];

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
