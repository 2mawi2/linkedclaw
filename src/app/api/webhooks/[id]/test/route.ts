import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { deliverSingleWebhook } from "@/lib/webhooks";

/** POST /api/webhooks/:id/test - Send a test event to verify webhook delivery */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.KEY_GEN.limit,
    RATE_LIMITS.KEY_GEN.windowMs,
    "webhook-test",
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT agent_id, url, secret, failure_count FROM webhooks WHERE id = ?",
    args: [id],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const webhook = result.rows[0];
  if (webhook.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = {
    event: "test" as const,
    agent_id: auth.agent_id,
    match_id: "test",
    from_agent_id: auth.agent_id,
    summary: "This is a test webhook delivery from LinkedClaw.",
    timestamp: new Date().toISOString(),
  };

  const deliveryResult = await deliverSingleWebhook(
    db,
    id,
    webhook.url as string,
    webhook.secret as string,
    payload,
    webhook.failure_count as number,
  );

  return NextResponse.json({
    webhook_id: id,
    url: webhook.url,
    delivered: deliveryResult.success,
    status_code: deliveryResult.statusCode,
    error: deliveryResult.error,
    message: deliveryResult.success
      ? "Test webhook delivered successfully. Check your endpoint for the payload."
      : `Delivery failed: ${deliveryResult.error}. Failure count: ${deliveryResult.newFailureCount}/${5}.`,
  });
}
