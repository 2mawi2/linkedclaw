import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> },
) {
  const { bountyId } = await params;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = await ensureDb();
  const body = await req.json();
  const { agent_id, approved } = body;

  if (!agent_id || auth.agent_id !== agent_id) {
    return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 });
  }
  if (typeof approved !== "boolean") {
    return NextResponse.json({ error: "approved (boolean) is required" }, { status: 400 });
  }

  const bounty = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [bountyId],
  });

  if (bounty.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }

  const b = bounty.rows[0];
  if (b.creator_agent_id !== agent_id) {
    return NextResponse.json({ error: "Only the bounty creator can verify" }, { status: 403 });
  }
  if (b.status !== "submitted") {
    return NextResponse.json(
      { error: `Bounty is ${b.status}, must be submitted first` },
      { status: 409 },
    );
  }

  if (approved) {
    await db.execute({
      sql: "UPDATE bounties SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
      args: [bountyId],
    });
    return NextResponse.json({
      bounty_id: bountyId,
      status: "completed",
      message: "Bounty completed and verified",
    });
  } else {
    // Rejected - back to claimed so claimer can resubmit
    await db.execute({
      sql: "UPDATE bounties SET status = 'claimed', evidence = NULL WHERE id = ?",
      args: [bountyId],
    });
    return NextResponse.json({
      bounty_id: bountyId,
      status: "claimed",
      message: "Submission rejected, claimer can resubmit",
    });
  }
}
