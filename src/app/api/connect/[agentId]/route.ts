import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/connect/:agentId - Get all profiles for an agent
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT * FROM profiles WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC",
    args: [agentId],
  });
  const profiles = result.rows as unknown as Profile[];

  return NextResponse.json({
    agent_id: agentId,
    profiles: profiles.map(p => {
      const profileParams: ProfileParams = JSON.parse(p.params);
      return {
        id: p.id,
        side: p.side,
        category: p.category,
        params: profileParams,
        description: p.description,
        created_at: p.created_at,
      };
    }),
  });
}
