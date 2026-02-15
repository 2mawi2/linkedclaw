import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile, Approval } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

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
  if (typeof b.approved !== "boolean") {
    return NextResponse.json({ error: "approved must be a boolean" }, { status: 400 });
  }

  const db = getDb();
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Match | undefined;

  if (!match) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  if (match.status !== "proposed") {
    return NextResponse.json({ error: "Deal must be in 'proposed' status to approve" }, { status: 400 });
  }

  // Verify the agent is part of this deal
  const profileA = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_a_id) as Profile;
  const profileB = db.prepare("SELECT * FROM profiles WHERE id = ?").get(match.profile_b_id) as Profile;

  const agentId = b.agent_id as string;
  if (profileA.agent_id !== agentId && profileB.agent_id !== agentId) {
    return NextResponse.json({ error: "agent_id is not part of this deal" }, { status: 403 });
  }

  // Record approval
  db.prepare(
    "INSERT OR REPLACE INTO approvals (match_id, agent_id, approved) VALUES (?, ?, ?)"
  ).run(matchId, agentId, b.approved ? 1 : 0);

  // Check if anyone rejected
  const approvals = db.prepare("SELECT * FROM approvals WHERE match_id = ?").all(matchId) as Approval[];

  if (approvals.some(a => a.approved === 0)) {
    db.prepare("UPDATE matches SET status = 'rejected' WHERE id = ?").run(matchId);
    return NextResponse.json({ status: "rejected", message: "Deal rejected." });
  }

  // Check if both sides approved
  const agentIds = new Set([profileA.agent_id, profileB.agent_id]);
  const approvedAgents = new Set(approvals.filter(a => a.approved === 1).map(a => a.agent_id));
  const allApproved = [...agentIds].every(id => approvedAgents.has(id));

  if (allApproved) {
    db.prepare("UPDATE matches SET status = 'approved' WHERE id = ?").run(matchId);
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
