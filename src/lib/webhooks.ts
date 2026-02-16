import { createHmac } from "crypto";
import type { Client } from "@libsql/client";
import type { NotificationType } from "./notifications";

export interface WebhookPayload {
  event: NotificationType | "test";
  agent_id: string;
  match_id?: string;
  from_agent_id?: string;
  summary: string;
  timestamp: string;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  newFailureCount: number;
}

/** Sign a payload with HMAC-SHA256 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Verify an HMAC-SHA256 signature */
export function verifySignature(payload: string, secret: string, signature: string): boolean {
  const expected = signPayload(payload, secret);
  if (expected.length !== signature.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Max consecutive failures before auto-disabling a webhook */
const MAX_FAILURES = 5;

/** Deliver webhook to a single URL. Returns delivery result. */
export async function deliverSingleWebhook(
  db: Client,
  webhookId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  failureCount: number,
): Promise<DeliveryResult> {
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
      await db.execute({
        sql: "UPDATE webhooks SET failure_count = 0, last_triggered_at = datetime('now') WHERE id = ?",
        args: [webhookId],
      });
      return { success: true, statusCode: res.status, newFailureCount: 0 };
    } else {
      const newCount = await incrementFailure(db, webhookId, failureCount);
      return {
        success: false,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
        newFailureCount: newCount,
      };
    }
  } catch (err) {
    const newCount = await incrementFailure(db, webhookId, failureCount);
    const errorMsg =
      err instanceof Error && err.name === "AbortError"
        ? "Request timed out (10s)"
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: errorMsg, newFailureCount: newCount };
  }
}

async function incrementFailure(
  db: Client,
  webhookId: string,
  currentCount: number,
): Promise<number> {
  const newCount = currentCount + 1;
  const shouldDisable = newCount >= MAX_FAILURES;
  if (shouldDisable) {
    await db.execute({
      sql: `UPDATE webhooks SET failure_count = ?, active = 0, last_triggered_at = datetime('now') WHERE id = ?`,
      args: [newCount, webhookId],
    });
  } else {
    await db.execute({
      sql: `UPDATE webhooks SET failure_count = ?, last_triggered_at = datetime('now') WHERE id = ?`,
      args: [newCount, webhookId],
    });
  }
  return newCount;
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

      // Fire and forget
      deliverSingleWebhook(
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
