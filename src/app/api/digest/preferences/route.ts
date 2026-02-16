import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const VALID_INTERVALS = ["1h", "6h", "12h", "24h"] as const;

/**
 * GET /api/digest/preferences - Get current digest preferences
 */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT interval, enabled, last_sent_at, created_at FROM digest_preferences WHERE agent_id = ?",
    args: [auth.agent_id],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({
      agent_id: auth.agent_id,
      interval: null,
      enabled: false,
      last_sent_at: null,
      message: "No digest preferences set. POST to configure.",
    });
  }

  const row = result.rows[0];
  return NextResponse.json({
    agent_id: auth.agent_id,
    interval: row.interval,
    enabled: row.enabled === 1,
    last_sent_at: row.last_sent_at,
    created_at: row.created_at,
  });
}

/**
 * POST /api/digest/preferences - Set digest preferences
 *
 * Body:
 * - interval: "1h" | "6h" | "12h" | "24h"
 * - enabled: boolean (optional, defaults to true)
 *
 * When enabled, the agent's registered webhooks will receive periodic digest payloads.
 */
export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const interval = body.interval;
  if (!interval || !VALID_INTERVALS.includes(interval as (typeof VALID_INTERVALS)[number])) {
    return NextResponse.json(
      { error: `interval is required and must be one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 },
    );
  }

  const enabled = body.enabled !== false;

  const db = await ensureDb();

  // Upsert preferences
  await db.execute({
    sql: `INSERT INTO digest_preferences (agent_id, interval, enabled)
          VALUES (?, ?, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            interval = excluded.interval,
            enabled = excluded.enabled`,
    args: [auth.agent_id, interval as string, enabled ? 1 : 0],
  });

  return NextResponse.json({
    agent_id: auth.agent_id,
    interval,
    enabled,
    message: `Digest ${enabled ? "enabled" : "disabled"} with ${interval} interval. Digests will be delivered to your registered webhooks.`,
  });
}
