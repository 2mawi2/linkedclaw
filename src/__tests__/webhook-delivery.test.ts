import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { createApiKey } from "@/__tests__/test-helpers";
import {
  signPayload,
  verifySignature,
  deliverSingleWebhook,
  fireWebhooks,
} from "@/lib/webhooks";
import { createNotification } from "@/lib/notifications";
import { POST as webhookTestPOST } from "@/app/api/webhooks/[id]/test/route";
import { POST as webhooksPOST } from "@/app/api/webhooks/route";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

function req(url: string, opts?: RequestInit & { headers?: Record<string, string> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, BASE), opts as any);
}

let db: Client;
let restore: () => void;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe("HMAC Signature", () => {
  it("signs a payload deterministically", () => {
    const payload = '{"event":"test","agent_id":"a1"}';
    const secret = "mysecret";
    const sig1 = signPayload(payload, secret);
    const sig2 = signPayload(payload, secret);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different signatures for different secrets", () => {
    const payload = '{"event":"test"}';
    const sig1 = signPayload(payload, "secret1");
    const sig2 = signPayload(payload, "secret2");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const secret = "mysecret";
    const sig1 = signPayload('{"a":1}', secret);
    const sig2 = signPayload('{"a":2}', secret);
    expect(sig1).not.toBe(sig2);
  });

  it("verifies a valid signature", () => {
    const payload = '{"event":"new_match"}';
    const secret = "webhooksecret123";
    const signature = signPayload(payload, secret);
    expect(verifySignature(payload, secret, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = '{"event":"new_match"}';
    const secret = "webhooksecret123";
    expect(verifySignature(payload, secret, "0".repeat(64))).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const original = '{"event":"new_match"}';
    const secret = "webhooksecret123";
    const signature = signPayload(original, secret);
    const tampered = '{"event":"deal_approved"}';
    expect(verifySignature(tampered, secret, signature)).toBe(false);
  });

  it("rejects wrong-length signature", () => {
    const payload = '{"event":"test"}';
    expect(verifySignature(payload, "secret", "tooshort")).toBe(false);
  });
});

describe("Webhook delivery", () => {
  it("resets failure count on successful delivery", async () => {
    // Insert a webhook with some failures
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret123", "*", 1, 3],
    });

    // Mock successful fetch
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("OK", { status: 200 }),
    );

    const result = await deliverSingleWebhook(
      db,
      "wh-1",
      "https://example.com/hook",
      "secret123",
      {
        event: "new_match",
        agent_id: "agent-1",
        summary: "New match found",
        timestamp: new Date().toISOString(),
      },
      3,
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.newFailureCount).toBe(0);

    // Verify DB was updated
    const row = await db.execute({
      sql: "SELECT failure_count, last_triggered_at FROM webhooks WHERE id = 'wh-1'",
      args: [],
    });
    expect(row.rows[0].failure_count).toBe(0);
    expect(row.rows[0].last_triggered_at).not.toBeNull();
  });

  it("increments failure count on HTTP error", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret123", "*", 1, 0],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const result = await deliverSingleWebhook(
      db,
      "wh-1",
      "https://example.com/hook",
      "secret123",
      {
        event: "new_match",
        agent_id: "agent-1",
        summary: "New match found",
        timestamp: new Date().toISOString(),
      },
      0,
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe("HTTP 500");
    expect(result.newFailureCount).toBe(1);

    const row = await db.execute({
      sql: "SELECT failure_count, active FROM webhooks WHERE id = 'wh-1'",
      args: [],
    });
    expect(row.rows[0].failure_count).toBe(1);
    expect(row.rows[0].active).toBe(1); // Still active
  });

  it("auto-disables webhook after MAX_FAILURES (5)", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret123", "*", 1, 4],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Gateway", { status: 502 }),
    );

    const result = await deliverSingleWebhook(
      db,
      "wh-1",
      "https://example.com/hook",
      "secret123",
      {
        event: "new_match",
        agent_id: "agent-1",
        summary: "New match found",
        timestamp: new Date().toISOString(),
      },
      4,
    );

    expect(result.success).toBe(false);
    expect(result.newFailureCount).toBe(5);

    const row = await db.execute({
      sql: "SELECT failure_count, active FROM webhooks WHERE id = 'wh-1'",
      args: [],
    });
    expect(row.rows[0].failure_count).toBe(5);
    expect(row.rows[0].active).toBe(0); // Auto-disabled
  });

  it("handles network errors gracefully", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret123", "*", 1, 0],
    });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await deliverSingleWebhook(
      db,
      "wh-1",
      "https://example.com/hook",
      "secret123",
      {
        event: "new_match",
        agent_id: "agent-1",
        summary: "New match found",
        timestamp: new Date().toISOString(),
      },
      0,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
    expect(result.newFailureCount).toBe(1);
  });

  it("handles timeout errors", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret123", "*", 1, 0],
    });

    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    const result = await deliverSingleWebhook(
      db,
      "wh-1",
      "https://example.com/hook",
      "secret123",
      {
        event: "new_match",
        agent_id: "agent-1",
        summary: "New match found",
        timestamp: new Date().toISOString(),
      },
      0,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Request timed out (10s)");
  });

  it("sends correct headers including signature", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "mysecret", "*", 1, 0],
    });

    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      capturedHeaders = new Headers(init?.headers as HeadersInit);
      capturedBody = init?.body as string;
      return new Response("OK", { status: 200 });
    });

    const payload = {
      event: "deal_approved" as const,
      agent_id: "agent-1",
      match_id: "match-123",
      summary: "Deal approved",
      timestamp: "2026-02-16T12:00:00.000Z",
    };

    await deliverSingleWebhook(db, "wh-1", "https://example.com/hook", "mysecret", payload, 0);

    expect(capturedHeaders!.get("Content-Type")).toBe("application/json");
    expect(capturedHeaders!.get("X-LinkedClaw-Event")).toBe("deal_approved");
    const signature = capturedHeaders!.get("X-LinkedClaw-Signature")!;
    expect(signature).toMatch(/^[a-f0-9]{64}$/);

    // Verify the signature is correct
    expect(verifySignature(capturedBody!, "mysecret", signature)).toBe(true);
  });
});

describe("fireWebhooks event filtering", () => {
  it("delivers to wildcard (*) webhooks", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret1", "*", 1, 0],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    await fireWebhooks(db, "agent-1", "new_match", "match-1", "agent-2", "New match");
    // Give fire-and-forget time to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("delivers only to webhooks subscribed to the event", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-match", "agent-1", "https://example.com/matches", "s1", "new_match", 1, 0],
    });
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-deal", "agent-1", "https://example.com/deals", "s2", "deal_approved", 1, 0],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    await fireWebhooks(db, "agent-1", "new_match", "match-1", undefined, "New match");
    await new Promise((r) => setTimeout(r, 50));

    // Only the match webhook should fire
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe("https://example.com/matches");
  });

  it("skips inactive webhooks", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "s1", "*", 0, 5],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    await fireWebhooks(db, "agent-1", "new_match", "match-1", undefined, "New match");
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips webhooks for other agents", async () => {
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-2", "https://example.com/hook", "s1", "*", 1, 0],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    await fireWebhooks(db, "agent-1", "new_match", "match-1", undefined, "New match");
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Notification -> Webhook integration", () => {
  it("fires webhooks when a notification is created", async () => {
    // Register a webhook
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook", "secret1", "*", 1, 0],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    await createNotification(db, {
      agent_id: "agent-1",
      type: "deal_approved",
      match_id: "match-123",
      from_agent_id: "agent-2",
      summary: "Your deal has been approved!",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.event).toBe("deal_approved");
    expect(body.agent_id).toBe("agent-1");
    expect(body.match_id).toBe("match-123");
    expect(body.summary).toBe("Your deal has been approved!");
  });
});

describe("POST /api/webhooks/:id/test", () => {
  it("sends a test event to the webhook URL", async () => {
    const apiKey = await createApiKey("agent-1");

    // Create a webhook first
    const createRes = await webhooksPOST(
      req("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url: "https://example.com/hook" }),
      }),
    );
    const { webhook_id } = await createRes.json();

    // Mock successful delivery
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("OK", { status: 200 }),
    );

    const res = await webhookTestPOST(
      req(`/api/webhooks/${webhook_id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      { params: Promise.resolve({ id: webhook_id }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.delivered).toBe(true);
    expect(data.status_code).toBe(200);
    expect(data.url).toBe("https://example.com/hook");
  });

  it("reports delivery failure", async () => {
    const apiKey = await createApiKey("agent-1");

    const createRes = await webhooksPOST(
      req("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ url: "https://example.com/hook" }),
      }),
    );
    const { webhook_id } = await createRes.json();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const res = await webhookTestPOST(
      req(`/api/webhooks/${webhook_id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      { params: Promise.resolve({ id: webhook_id }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.delivered).toBe(false);
    expect(data.status_code).toBe(404);
    expect(data.error).toContain("HTTP 404");
  });

  it("requires authentication", async () => {
    const res = await webhookTestPOST(
      req("/api/webhooks/some-id/test", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "some-id" }) },
    );
    expect(res.status).toBe(401);
  });

  it("prevents testing another agent's webhook", async () => {
    const apiKey1 = await createApiKey("agent-1");
    const apiKey2 = await createApiKey("agent-2");

    const createRes = await webhooksPOST(
      req("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey1}` },
        body: JSON.stringify({ url: "https://example.com/hook" }),
      }),
    );
    const { webhook_id } = await createRes.json();

    const res = await webhookTestPOST(
      req(`/api/webhooks/${webhook_id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey2}` },
      }),
      { params: Promise.resolve({ id: webhook_id }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-existent webhook", async () => {
    const apiKey = await createApiKey("agent-1");
    const res = await webhookTestPOST(
      req("/api/webhooks/nonexistent/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(res.status).toBe(404);
  });
});
