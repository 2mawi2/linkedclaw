import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getAgentRecommendations } from "@/lib/agent-recommendations";

/**
 * GET /api/recommendations - Get agent recommendations
 *
 * Returns agents similar to the authenticated agent, based on category overlap
 * and shared deal partners. "Agents like you also worked with..."
 *
 * Query params:
 *   - limit: max recommendations (1-50, default 10)
 *
 * Auth required.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, RATE_LIMITS.READ.limit, RATE_LIMITS.READ.windowMs, "recommendations");
  if (rl) return rl;

  const agent = await authenticateAny(req);
  const db = await ensureDb();
  if (!agent) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit") ?? "10";
  const limit = parseInt(limitParam, 10);

  if (isNaN(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: "limit must be between 1 and 50" }, { status: 400 });
  }

  const recommendations = await getAgentRecommendations(db, agent.agent_id, { limit });

  return NextResponse.json({
    recommendations,
    agent_id: agent.agent_id,
    generated_at: new Date().toISOString(),
  });
}
