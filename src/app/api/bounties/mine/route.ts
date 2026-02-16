import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** GET /api/bounties/mine - list bounties created by the authenticated agent */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    "bounties-mine",
  );
  if (rl) return rl;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agent_id query parameter is required" }, { status: 400 });
  }

  if (auth.agent_id !== agentId) {
    return NextResponse.json(
      { error: "Forbidden: agent_id does not match authenticated user" },
      { status: 403 },
    );
  }

  const db = await ensureDb();

  const result = await db.execute({
    sql: `SELECT * FROM bounties WHERE creator_agent_id = ? ORDER BY created_at DESC`,
    args: [agentId],
  });

  const bounties = result.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    skills: JSON.parse(String(r.skills || "[]")),
    budget_min: r.budget_min ?? null,
    budget_max: r.budget_max ?? null,
    currency: r.currency || "USD",
    deadline: r.deadline ?? null,
    status: r.status,
    assigned_agent_id: r.assigned_agent_id ?? null,
    created_at: r.created_at,
  }));

  return NextResponse.json({ bounties });
}
