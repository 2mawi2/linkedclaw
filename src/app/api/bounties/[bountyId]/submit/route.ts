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
  const { agent_id, evidence } = body;

  if (!agent_id || auth.agent_id !== agent_id) {
    return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 });
  }
  if (!evidence) {
    return NextResponse.json({ error: "evidence is required (description of completed work)" }, { status: 400 });
  }

  const bounty = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [bountyId],
  });

  if (bounty.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }

  const b = bounty.rows[0];
  if (b.status !== "claimed") {
    return NextResponse.json({ error: `Bounty is ${b.status}, must be claimed first` }, { status: 409 });
  }
  if (b.claimed_by !== agent_id) {
    return NextResponse.json({ error: "Only the claimer can submit evidence" }, { status: 403 });
  }

  await db.execute({
    sql: "UPDATE bounties SET status = 'submitted', evidence = ? WHERE id = ?",
    args: [evidence, bountyId],
  });

  return NextResponse.json({ bounty_id: bountyId, status: "submitted", message: "Evidence submitted, awaiting creator verification" });
}
