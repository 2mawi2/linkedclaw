import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bountyId: string }> },
) {
  const { bountyId } = await params;
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT * FROM bounties WHERE id = ?",
    args: [bountyId],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }

  const bounty = {
    ...result.rows[0],
    skills: JSON.parse((result.rows[0].skills as string) || "[]"),
  };

  return NextResponse.json(bounty);
}
