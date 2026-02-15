import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile } from "@/lib/types";
import { createNotification } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
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

  if (match.status !== "in_progress") {
    return NextResponse.json({ error: "Only in_progress deals can be completed" }, { status: 400 });
  }

  // Verify participant
  const profileAResult = await db.execute({ sql: "SELECT * FROM profiles WHERE id = ?", args: [match.profile_a_id] });
  const profileA = profileAResult.rows[0] as unknown as Profile;
  const profileBResult = await db.execute({ sql: "SELECT * FROM profiles WHERE id = ?", args: [match.profile_b_id] });
  const profileB = profileBResult.rows[0] as unknown as Profile;

  if (profileA.agent_id !== b.agent_id && profileB.agent_id !== b.agent_id) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Check for duplicate completion
  const existingCompletion = await db.execute({
    sql: "SELECT * FROM deal_completions WHERE match_id = ? AND agent_id = ?",
    args: [matchId, b.agent_id],
  });
  if (existingCompletion.rows.length > 0) {
    return NextResponse.json({ error: "You have already confirmed completion" }, { status: 409 });
  }

  // Record completion
  await db.execute({
    sql: "INSERT INTO deal_completions (match_id, agent_id) VALUES (?, ?)",
    args: [matchId, b.agent_id],
  });

  // Check if both parties have confirmed
  const allCompletions = await db.execute({
    sql: "SELECT * FROM deal_completions WHERE match_id = ?",
    args: [matchId],
  });

  const counterpartId = profileA.agent_id === b.agent_id ? profileB.agent_id : profileA.agent_id;

  if (allCompletions.rows.length >= 2) {
    // Both confirmed - mark as completed
    await db.execute({
      sql: "UPDATE matches SET status = 'completed' WHERE id = ?",
      args: [matchId],
    });

    await db.execute({
      sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)",
      args: [matchId, b.agent_id, "Deal completed! Both parties confirmed.", "system"],
    });

    await createNotification(db, {
      agent_id: counterpartId,
      type: "deal_completed",
      match_id: matchId,
      from_agent_id: b.agent_id as string,
      summary: "Deal completed! Both parties confirmed.",
    });
    await createNotification(db, {
      agent_id: b.agent_id as string,
      type: "deal_completed",
      match_id: matchId,
      from_agent_id: counterpartId,
      summary: "Deal completed! Both parties confirmed.",
    });

    return NextResponse.json({
      status: "completed",
      message: "Both parties confirmed! Deal is completed.",
    });
  } else {
    // Waiting for other party
    await createNotification(db, {
      agent_id: counterpartId,
      type: "deal_completion_requested",
      match_id: matchId,
      from_agent_id: b.agent_id as string,
      summary: `${b.agent_id} has confirmed deal completion. Please confirm too.`,
    });

    return NextResponse.json({
      status: "waiting",
      message: "Your completion confirmed. Waiting for the other party.",
    });
  }
}
