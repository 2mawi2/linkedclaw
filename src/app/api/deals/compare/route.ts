import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Match, Profile } from "@/lib/types";

interface MessageRow {
  id: number;
  match_id: string;
  sender_agent_id: string;
  content: string;
  message_type: string;
  proposed_terms: string | null;
  created_at: string;
}

interface DealComparison {
  match_id: string;
  status: string;
  counterpart_agent_id: string;
  counterpart_description: string | null;
  created_at: string;
  overlap: unknown;
  latest_proposal: {
    sender_agent_id: string;
    content: string;
    proposed_terms: unknown;
    created_at: string;
  } | null;
  message_count: number;
}

/**
 * GET /api/deals/compare?match_ids=id1,id2,id3
 *
 * Compare multiple deals/proposals side-by-side.
 * Returns deal metadata + latest proposal for each deal.
 * Auth required - only shows deals the authenticated agent is part of.
 * Max 10 deals per comparison.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "deals-compare");
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const matchIdsParam = searchParams.get("match_ids");

  if (!matchIdsParam || matchIdsParam.trim().length === 0) {
    return NextResponse.json(
      { error: "match_ids query parameter is required (comma-separated)" },
      { status: 400 },
    );
  }

  const matchIds = matchIdsParam.split(",").map((id) => id.trim()).filter(Boolean);

  if (matchIds.length < 2) {
    return NextResponse.json(
      { error: "At least 2 match_ids are required for comparison" },
      { status: 400 },
    );
  }

  if (matchIds.length > 10) {
    return NextResponse.json(
      { error: "Maximum 10 deals can be compared at once" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Get all the agent's profile IDs
  const profilesResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ?",
    args: [auth.agent_id],
  });
  const agentProfileIds = new Set(
    (profilesResult.rows as unknown as Array<{ id: string }>).map((p) => p.id),
  );

  const comparisons: DealComparison[] = [];

  for (const matchId of matchIds) {
    // Fetch the match
    const matchResult = await db.execute({
      sql: "SELECT * FROM matches WHERE id = ?",
      args: [matchId],
    });
    const match = matchResult.rows[0] as unknown as Match | undefined;

    if (!match) continue;

    // Verify agent is part of this deal
    if (!agentProfileIds.has(match.profile_a_id) && !agentProfileIds.has(match.profile_b_id)) {
      continue;
    }

    // Get counterpart info
    const isProfileA = agentProfileIds.has(match.profile_a_id);
    const counterpartProfileId = isProfileA ? match.profile_b_id : match.profile_a_id;

    const counterpartResult = await db.execute({
      sql: "SELECT agent_id, description FROM profiles WHERE id = ?",
      args: [counterpartProfileId],
    });
    const counterpart = counterpartResult.rows[0] as unknown as
      | { agent_id: string; description: string | null }
      | undefined;

    // Get latest proposal message
    const proposalResult = await db.execute({
      sql: `SELECT * FROM messages 
            WHERE match_id = ? AND message_type = 'proposal' 
            ORDER BY id DESC LIMIT 1`,
      args: [matchId],
    });
    const latestProposal = proposalResult.rows[0] as unknown as MessageRow | undefined;

    // Get message count
    const countResult = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM messages WHERE match_id = ?",
      args: [matchId],
    });
    const messageCount = Number((countResult.rows[0] as unknown as { cnt: number }).cnt);

    comparisons.push({
      match_id: matchId,
      status: match.status,
      counterpart_agent_id: counterpart?.agent_id ?? "unknown",
      counterpart_description: counterpart?.description ?? null,
      created_at: match.created_at,
      overlap: JSON.parse(match.overlap_summary),
      latest_proposal: latestProposal
        ? {
            sender_agent_id: latestProposal.sender_agent_id,
            content: latestProposal.content,
            proposed_terms: latestProposal.proposed_terms
              ? JSON.parse(latestProposal.proposed_terms)
              : null,
            created_at: latestProposal.created_at,
          }
        : null,
      message_count: messageCount,
    });
  }

  if (comparisons.length < 2) {
    return NextResponse.json(
      { error: "Could not find at least 2 valid deals for comparison" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    comparisons,
    count: comparisons.length,
  });
}
