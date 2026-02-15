import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withReadRateLimit } from "@/lib/rate-limit";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/connect/:agentId - Get all profiles for an agent
 * 
 * Returns all active profiles belonging to the specified agent.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const rateLimited = withReadRateLimit(_req);
  if (rateLimited) return rateLimited;

  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const db = getDb();
  const profiles = db.prepare(
    "SELECT * FROM profiles WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC"
  ).all(agentId) as Profile[];

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
