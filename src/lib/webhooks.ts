import { createHmac } from "crypto";
import type { Client } from "@libsql/client";
import type { NotificationType } from "./notifications";

export interface WebhookPayload {
  event: NotificationType;
  agent_id: string;
  match_id?: string;
  from_agent_id?: string;
  summary: string;
  timestamp: string;
}

/** Sign a payload with HMAC-SHA256 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Max consecutive failures before auto-disabling a webhook */
const MAX_FAILURES = 5;

/** Deliver webhook to a single URL. Fire-and-forget. */
async function deliverWebhook(
  db: Client,
  webhookId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  failureCount: number,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LinkedClaw-Signature": signature,
        "X-LinkedClaw-Event": payload.event,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      // Reset failure count on success
      await db.execute({
        sql: "UPDATE webhooks SET failure_count = 0, last_triggered_at = datetime('now') WHERE id = ?",
        args: [webhookId],
      });
    } else {
      await incrementFailure(db, webhookId, failureCount);
    }
  } catch {
    await incrementFailure(db, webhookId, failureCount);
  }
}

async function incrementFailure(
  db: Client,
  webhookId: string,
  currentCount: number,
): Promise<void> {
  const newCount = currentCount + 1;
  const disable = newCount >= MAX_FAILURES;
  await db.execute({
    sql: `UPDATE webhooks SET failure_count = ?, active = CASE WHEN ? THEN 0 ELSE active END, last_triggered_at = datetime('now') WHERE id = ?`,
    args: [newCount, disable ? 1 : 0, webhookId],
  });
}

/** Fire webhooks for an agent's notification. Non-blocking. */
export async function fireWebhooks(
  db: Client,
  agentId: string,
  event: NotificationType,
  matchId: string | undefined,
  fromAgentId: string | undefined,
  summary: string,
): Promise<void> {
  try {
    const result = await db.execute({
      sql: "SELECT id, url, secret, events, failure_count FROM webhooks WHERE agent_id = ? AND active = 1",
      args: [agentId],
    });

    if (result.rows.length === 0) return;

    const payload: WebhookPayload = {
      event,
      agent_id: agentId,
      match_id: matchId,
      from_agent_id: fromAgentId,
      summary,
      timestamp: new Date().toISOString(),
    };

    for (const row of result.rows) {
      const events = row.events as string;
      // Check if webhook subscribes to this event
      if (events !== "*") {
        const eventList = events.split(",").map((e) => e.trim());
        if (!eventList.includes(event)) continue;
      }

      // Fire and forget - don't await all in sequence, use Promise.allSettled
      deliverWebhook(
        db,
        row.id as string,
        row.url as string,
        row.secret as string,
        payload,
        row.failure_count as number,
      ).catch(() => {}); // swallow errors - webhook delivery must never break the caller
    }
  } catch {
    // Webhook lookup/delivery should never break the main operation
  }
}
