import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ bountyId: string }> }) {
  const { bountyId } = await params;
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = await ensureDb();
  const body = await req.json();
  const { agent_id } = body;

  if (!agent_id || auth.agent_id !== agent_id) {
    return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 });
  }

  const bounty = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [bountyId],
  });

  if (bounty.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }

  const b = bounty.rows[0];
  if (b.status !== "open") {
    return NextResponse.json({ error: `Bounty is ${b.status}, not open` }, { status: 409 });
  }
  if (b.creator_agent_id === agent_id) {
    return NextResponse.json({ error: "Cannot claim your own bounty" }, { status: 400 });
  }

  await db.execute({
    sql: "UPDATE bounties SET status = 'claimed', claimed_by = ? WHERE id = ? AND status = 'open'",
    args: [agent_id, bountyId],
  });

  return NextResponse.json({ bounty_id: bountyId, status: "claimed", claimed_by: agent_id });
}
