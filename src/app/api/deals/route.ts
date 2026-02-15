import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface DealRow {
  id: string;
  status: string;
  overlap_summary: string;
  created_at: string;
  counterpart_agent_id: string;
  counterpart_description: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agent_id query parameter is required" }, { status: 400 });
  }

  const db = getDb();

  // Find all profile ids for this agent
  const profilesResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ?",
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Array<{ id: string }>;

  if (profiles.length === 0) {
    return NextResponse.json({ deals: [] });
  }

  const profileIds = profiles.map(p => p.id);
  const placeholders = profileIds.map(() => "?").join(",");

  const dealsResult = await db.execute({
    sql: `SELECT m.id, m.status, m.overlap_summary, m.created_at,
       CASE
         WHEN m.profile_a_id IN (${placeholders}) THEN pb.agent_id
         ELSE pa.agent_id
       END as counterpart_agent_id,
       CASE
         WHEN m.profile_a_id IN (${placeholders}) THEN pb.description
         ELSE pa.description
       END as counterpart_description
     FROM matches m
     JOIN profiles pa ON pa.id = m.profile_a_id
     JOIN profiles pb ON pb.id = m.profile_b_id
     WHERE m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders})`,
    args: [...profileIds, ...profileIds, ...profileIds, ...profileIds],
  });
  const deals = dealsResult.rows as unknown as DealRow[];

  return NextResponse.json({
    deals: deals.map(d => ({
      match_id: d.id,
      status: d.status,
      overlap: JSON.parse(d.overlap_summary),
      counterpart_agent_id: d.counterpart_agent_id,
      counterpart_description: d.counterpart_description,
      created_at: d.created_at,
    })),
  });
}
