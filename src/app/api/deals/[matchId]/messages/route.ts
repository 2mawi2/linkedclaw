import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import type { Match, Profile, SendMessageRequest } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }
  if (!b.content || typeof b.content !== "string" || b.content.trim().length === 0) {
    return NextResponse.json({ error: "content is required and must be a non-empty string" }, { status: 400 });
  }

  const messageType = (b.message_type as string) ?? "negotiation";
  if (!["negotiation", "proposal", "system"].includes(messageType)) {
    return NextResponse.json({ error: "message_type must be 'negotiation', 'proposal', or 'system'" }, { status: 400 });
  }

  if (messageType === "proposal" && (!b.proposed_terms || typeof b.proposed_terms !== "object")) {
    return NextResponse.json({ error: "proposed_terms is required when message_type is 'proposal'" }, { status: 400 });
  }

  const data: SendMessageRequest = {
    agent_id: b.agent_id as string,
    content: b.content as string,
    message_type: messageType as SendMessageRequest["message_type"],
    proposed_terms: b.proposed_terms as Record<string, unknown> | undefined,
  };

  const db = getDb();
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (match.status === "approved" || match.status === "rejected" || match.status === "expired") {
    return NextResponse.json({ error: `Deal is already ${match.status}` }, { status: 400 });
  }

  // Verify the agent is part of this deal
  const profileA = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_a_id) as Profile;
  const profileB = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_b_id) as Profile;

  if (profileA.agent_id !== data.agent_id && profileB.agent_id !== data.agent_id) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Insert message
  const result = db.prepare(
    "INSERT INTO messages (match_id, sender_agent_id, content, message_type, proposed_terms) VALUES (?, ?, ?, ?, ?)"
  ).run(matchId, data.agent_id, data.content, data.message_type ?? "negotiation", data.proposed_terms ? JSON.stringify(data.proposed_terms) : null);

  // Update match status
  if (data.message_type === "proposal") {
    db.prepare("UPDATE matches SET status = 'proposed' WHERE id = ?").run(matchId);
  } else if (match.status === "matched") {
    db.prepare("UPDATE matches SET status = 'negotiating' WHERE id = ?").run(matchId);
  }

  return NextResponse.json({
    message_id: result.lastInsertRowid,
    status: data.message_type === "proposal" ? "proposed" : (match.status === "matched" ? "negotiating" : match.status),
  });
}
