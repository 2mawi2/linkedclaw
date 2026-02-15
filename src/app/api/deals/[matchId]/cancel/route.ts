import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile } from "@/lib/types";

const CANCELLABLE_STATUSES = ["matched", "negotiating", "proposed"];

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

  const db = await ensureDb();
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (!CANCELLABLE_STATUSES.includes(match.status)) {
    return NextResponse.json(
      { error: `Cannot cancel deal in '${match.status}' status. Cancellable statuses: ${CANCELLABLE_STATUSES.join(", ")}` },
      { status: 400 }
    );
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

  const agentId = b.agent_id as string;
  if (profileA.agent_id !== agentId && profileB.agent_id !== agentId) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Cancel the deal
  await db.execute({
    sql: "UPDATE matches SET status = 'cancelled' WHERE id = ?",
    args: [matchId],
  });

  // Add a system message
  await db.execute({
    sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)",
    args: [matchId, agentId, `Deal cancelled by ${agentId}.${b.reason ? ` Reason: ${b.reason}` : ""}`, "system"],
  });

  const counterpartId = profileA.agent_id === agentId ? profileB.agent_id : profileA.agent_id;

  return NextResponse.json({
    status: "cancelled",
    message: "Deal has been cancelled.",
    counterpart_agent_id: counterpartId,
  });
}
