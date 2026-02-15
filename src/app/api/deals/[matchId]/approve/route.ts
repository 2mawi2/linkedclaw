import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile, Approval } from "@/lib/types";
import { createNotification } from "@/lib/notifications";

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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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
  if (typeof b.approved !== "boolean") {
    return NextResponse.json({ error: "approved must be a boolean" }, { status: 400 });
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

  if (match.status !== "proposed") {
    return NextResponse.json(
      { error: "Deal must be in 'proposed' status to approve" },
      { status: 400 },
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

  // Record approval
  await db.execute({
    sql: "INSERT OR REPLACE INTO approvals (match_id, agent_id, approved) VALUES (?, ?, ?)",
    args: [matchId, agentId, b.approved ? 1 : 0],
  });

  // Check if anyone rejected
  const approvalsResult = await db.execute({
    sql: "SELECT * FROM approvals WHERE match_id = ?",
    args: [matchId],
  });
  const approvals = approvalsResult.rows as unknown as Approval[];

  if (approvals.some((a) => a.approved === 0)) {
    await db.execute({
      sql: "UPDATE matches SET status = 'rejected' WHERE id = ?",
      args: [matchId],
    });
    const counterpartId = profileA.agent_id === agentId ? profileB.agent_id : profileA.agent_id;
    await createNotification(db, {
      agent_id: counterpartId,
      type: "deal_rejected",
      match_id: matchId,
      from_agent_id: agentId,
      summary: `Deal rejected by ${agentId}`,
    });
    return NextResponse.json({ status: "rejected", message: "Deal rejected." });
  }

  // Check if both sides approved
  const agentIds = new Set([profileA.agent_id, profileB.agent_id]);
  const approvedAgents = new Set(approvals.filter((a) => a.approved === 1).map((a) => a.agent_id));
  const allApproved = [...agentIds].every((id) => approvedAgents.has(id));

  if (allApproved) {
    await db.execute({
      sql: "UPDATE matches SET status = 'approved' WHERE id = ?",
      args: [matchId],
    });
    for (const notifyAgent of [profileA.agent_id, profileB.agent_id]) {
      const otherAgent = notifyAgent === profileA.agent_id ? profileB.agent_id : profileA.agent_id;
      await createNotification(db, {
        agent_id: notifyAgent,
        type: "deal_approved",
        match_id: matchId,
        from_agent_id: otherAgent,
        summary: `Deal approved! Both parties agreed.`,
      });
    }
    return NextResponse.json({
      status: "approved",
      message: "Both parties approved! Deal is finalized.",
      contact_exchange: {
        agent_a: profileA.agent_id,
        agent_b: profileB.agent_id,
      },
    });
  }

  return NextResponse.json({
    status: "waiting",
    message: "Your approval has been recorded. Waiting for the other party.",
  });
}
