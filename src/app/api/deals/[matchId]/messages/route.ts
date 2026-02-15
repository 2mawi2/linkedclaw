import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile, SendMessageRequest } from "@/lib/types";
import { createNotification } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
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

  let messageType = (b.message_type as string) ?? "negotiation";
  // Accept "text" as alias for "negotiation" (agents naturally use this)
  if (messageType === "text") messageType = "negotiation";
  if (!["negotiation", "proposal", "system"].includes(messageType)) {
    return NextResponse.json({ error: "message_type must be 'negotiation', 'proposal', 'system', or 'text'" }, { status: 400 });
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

  const db = await ensureDb();
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Block messaging on terminal/cancelled states, but allow on approved (post-deal coordination)
  if (match.status === "rejected" || match.status === "expired" || match.status === "cancelled") {
    return NextResponse.json({ error: `Deal is ${match.status}, no further messages allowed` }, { status: 400 });
  }

  // Verify the agent is part of this deal
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

  if (profileA.agent_id !== data.agent_id && profileB.agent_id !== data.agent_id) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Insert message
  const result = await db.execute({
    sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type, proposed_terms) VALUES (?, ?, ?, ?, ?)",
    args: [matchId, data.agent_id, data.content, data.message_type ?? "negotiation", data.proposed_terms ? JSON.stringify(data.proposed_terms) : null],
  });

  // Update match status
  if (data.message_type === "proposal") {
    await db.execute({
      sql: "UPDATE matches SET status = 'proposed' WHERE id = ?",
      args: [matchId],
    });
  } else if (match.status === "matched") {
    await db.execute({
      sql: "UPDATE matches SET status = 'negotiating' WHERE id = ?",
      args: [matchId],
    });
  }

  // Notify counterpart
  const counterpartId = profileA.agent_id === data.agent_id ? profileB.agent_id : profileA.agent_id;
  await createNotification(db, {
    agent_id: counterpartId,
    type: data.message_type === "proposal" ? "deal_proposed" : "message_received",
    match_id: matchId,
    from_agent_id: data.agent_id,
    summary: data.message_type === "proposal"
      ? `Deal proposed by ${data.agent_id}`
      : `New message from ${data.agent_id}`,
  });

  return NextResponse.json({
    message_id: Number(result.lastInsertRowid),
    status: data.message_type === "proposal" ? "proposed" : (match.status === "matched" ? "negotiating" : match.status),
  });
}
