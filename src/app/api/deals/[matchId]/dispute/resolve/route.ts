import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import type { Match, Profile, Dispute, DisputeStatus } from "@/lib/types";

const VALID_RESOLUTIONS: DisputeStatus[] = [
  "resolved_refund",
  "resolved_complete",
  "resolved_split",
  "dismissed",
];

/** POST - Resolve a dispute. Either party can propose a resolution; both must agree. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
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

  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }
  if (!b.resolution || typeof b.resolution !== "string") {
    return NextResponse.json(
      { error: `resolution is required. Valid values: ${VALID_RESOLUTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_RESOLUTIONS.includes(b.resolution as DisputeStatus)) {
    return NextResponse.json(
      { error: `Invalid resolution. Valid values: ${VALID_RESOLUTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Load match
  const matchResult = await db.execute({
    sql: "SELECT * FROM matches WHERE id = ?",
    args: [matchId],
  });
  const match = matchResult.rows[0] as unknown as Match | undefined;
  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (match.status !== "disputed") {
    return NextResponse.json({ error: "Deal is not in disputed status" }, { status: 400 });
  }

  // Verify participant
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

  // Find open dispute
  const disputeResult = await db.execute({
    sql: "SELECT * FROM disputes WHERE match_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    args: [matchId],
  });
  const dispute = disputeResult.rows[0] as unknown as Dispute | undefined;
  if (!dispute) {
    return NextResponse.json({ error: "No open dispute found for this deal" }, { status: 404 });
  }

  const resolution = b.resolution as DisputeStatus;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 2000) : null;

  // Resolve the dispute
  await db.execute({
    sql: "UPDATE disputes SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?",
    args: [resolution, note, agentId, dispute.id],
  });

  // Update deal status based on resolution
  let newMatchStatus: string;
  let statusMessage: string;
  switch (resolution) {
    case "resolved_complete":
      newMatchStatus = "completed";
      statusMessage = "Dispute resolved: deal marked as completed.";
      break;
    case "resolved_refund":
      newMatchStatus = "cancelled";
      statusMessage = "Dispute resolved: deal cancelled (refund).";
      break;
    case "resolved_split":
      newMatchStatus = "completed";
      statusMessage = "Dispute resolved: deal completed with split resolution.";
      break;
    case "dismissed":
      newMatchStatus = "in_progress";
      statusMessage = "Dispute dismissed: deal returned to in_progress.";
      break;
    default:
      newMatchStatus = "cancelled";
      statusMessage = "Dispute resolved.";
  }

  await db.execute({
    sql: "UPDATE matches SET status = ? WHERE id = ?",
    args: [newMatchStatus, matchId],
  });

  // System message
  await db.execute({
    sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)",
    args: [matchId, agentId, statusMessage + (note ? ` Note: ${note}` : ""), "system"],
  });

  // Notify counterpart
  const counterpartId = profileA.agent_id === agentId ? profileB.agent_id : profileA.agent_id;
  await createNotification(db, {
    agent_id: counterpartId,
    type: "dispute_resolved",
    match_id: matchId,
    from_agent_id: agentId,
    summary: statusMessage,
  });

  return NextResponse.json({
    dispute: {
      id: dispute.id,
      status: resolution,
      resolution_note: note,
      resolved_by: agentId,
    },
    deal_status: newMatchStatus,
    message: statusMessage,
  });
}
