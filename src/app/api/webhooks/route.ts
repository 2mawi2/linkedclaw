import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { NotificationType } from "@/lib/notifications";

const VALID_EVENTS: NotificationType[] = [
  "new_match",
  "message_received",
  "deal_proposed",
  "deal_approved",
  "deal_rejected",
  "deal_expired",
  "deal_cancelled",
  "deal_started",
  "deal_completed",
  "deal_completion_requested",
  "milestone_updated",
  "milestone_created",
];

const MAX_WEBHOOKS_PER_AGENT = 5;

/** POST /api/webhooks - Register a new webhook */
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

  // Validate URL
  const url = body.url;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required and must be a string" }, { status: 400 });
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "url must use http or https" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "url must be a valid URL" }, { status: 400 });
  }

  // Validate events filter (optional, defaults to all)
  let events = "*";
  if (body.events !== undefined) {
    if (!Array.isArray(body.events)) {
      return NextResponse.json(
        { error: "events must be an array of event types" },
        { status: 400 },
      );
    }
    for (const e of body.events) {
      if (!VALID_EVENTS.includes(e as NotificationType)) {
        return NextResponse.json(
          { error: `Invalid event type: ${e}. Valid types: ${VALID_EVENTS.join(", ")}` },
          { status: 400 },
        );
      }
    }
    if (body.events.length > 0) {
      events = (body.events as string[]).join(",");
    }
  }

  const db = await ensureDb();

  // Check webhook limit
  const countResult = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM webhooks WHERE agent_id = ? AND active = 1",
    args: [auth.agent_id],
  });
  const count = countResult.rows[0].cnt as number;
  if (count >= MAX_WEBHOOKS_PER_AGENT) {
    return NextResponse.json(
      { error: `Maximum ${MAX_WEBHOOKS_PER_AGENT} active webhooks per agent` },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const secret = randomBytes(32).toString("hex");

  await db.execute({
    sql: "INSERT INTO webhooks (id, agent_id, url, secret, events) VALUES (?, ?, ?, ?, ?)",
    args: [id, auth.agent_id, url, secret, events],
  });

  return NextResponse.json({
    webhook_id: id,
    url,
    secret,
    events: events === "*" ? "all" : events.split(","),
    message:
      "Webhook registered. Store the secret - it won't be shown again. Use it to verify X-LinkedClaw-Signature headers on incoming webhooks.",
  });
}

/** GET /api/webhooks - List webhooks for an agent */
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
    sql: "SELECT id, url, events, active, failure_count, last_triggered_at, created_at FROM webhooks WHERE agent_id = ? ORDER BY created_at DESC",
    args: [auth.agent_id],
  });

  const webhooks = result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    events: (row.events as string) === "*" ? "all" : (row.events as string).split(","),
    active: row.active === 1,
    failure_count: row.failure_count,
    last_triggered_at: row.last_triggered_at,
    created_at: row.created_at,
  }));

  return NextResponse.json({ webhooks });
}
