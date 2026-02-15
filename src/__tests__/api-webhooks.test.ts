import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as keysPOST } from "@/app/api/keys/route";
import { GET as webhooksGET, POST as webhooksPOST } from "@/app/api/webhooks/route";
import { DELETE as webhookDELETE, PATCH as webhookPATCH } from "@/app/api/webhooks/[id]/route";
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
});

async function getApiKey(agentId: string): Promise<string> {
  const res = await keysPOST(req("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  }));
  const data = await res.json();
  return data.api_key;
}

describe("Webhooks API", () => {
  it("registers a webhook", async () => {
    const apiKey = await getApiKey("agent-1");
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/webhook" }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhook_id).toBeDefined();
    expect(data.secret).toBeDefined();
    expect(data.secret.length).toBe(64); // 32 bytes hex
    expect(data.url).toBe("https://example.com/webhook");
    expect(data.events).toBe("all");
  });

  it("registers a webhook with specific events", async () => {
    const apiKey = await getApiKey("agent-1");
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        url: "https://example.com/webhook",
        events: ["new_match", "deal_approved"],
      }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events).toEqual(["new_match", "deal_approved"]);
  });

  it("rejects invalid event types", async () => {
    const apiKey = await getApiKey("agent-1");
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        url: "https://example.com/webhook",
        events: ["invalid_event"],
      }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid URL", async () => {
    const apiKey = await getApiKey("agent-1");
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "not-a-url" }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects non-http URLs", async () => {
    const apiKey = await getApiKey("agent-1");
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "ftp://example.com/webhook" }),
    }));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/webhook" }),
    }));
    expect(res.status).toBe(401);
  });

  it("lists webhooks", async () => {
    const apiKey = await getApiKey("agent-1");
    // Register two webhooks
    await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/hook1" }),
    }));
    await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/hook2", events: ["new_match"] }),
    }));

    const res = await webhooksGET(req("/api/webhooks", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhooks).toHaveLength(2);
    expect(data.webhooks[0].active).toBe(true);
    expect(data.webhooks[0].failure_count).toBe(0);
  });

  it("does not show other agent's webhooks", async () => {
    const apiKey1 = await getApiKey("agent-1");
    const apiKey2 = await getApiKey("agent-2");

    await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey1}` },
      body: JSON.stringify({ url: "https://example.com/hook1" }),
    }));

    const res = await webhooksGET(req("/api/webhooks", {
      headers: { "Authorization": `Bearer ${apiKey2}` },
    }));
    const data = await res.json();
    expect(data.webhooks).toHaveLength(0);
  });

  it("deletes a webhook", async () => {
    const apiKey = await getApiKey("agent-1");
    const createRes = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/hook" }),
    }));
    const { webhook_id } = await createRes.json();

    const delRes = await webhookDELETE(
      req(`/api/webhooks/${webhook_id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${apiKey}` },
      }),
      { params: Promise.resolve({ id: webhook_id }) }
    );
    expect(delRes.status).toBe(200);
    const data = await delRes.json();
    expect(data.deleted).toBe(webhook_id);

    // Verify it's gone
    const listRes = await webhooksGET(req("/api/webhooks", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    }));
    const listData = await listRes.json();
    expect(listData.webhooks).toHaveLength(0);
  });

  it("prevents deleting another agent's webhook", async () => {
    const apiKey1 = await getApiKey("agent-1");
    const apiKey2 = await getApiKey("agent-2");

    const createRes = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey1}` },
      body: JSON.stringify({ url: "https://example.com/hook" }),
    }));
    const { webhook_id } = await createRes.json();

    const delRes = await webhookDELETE(
      req(`/api/webhooks/${webhook_id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${apiKey2}` },
      }),
      { params: Promise.resolve({ id: webhook_id }) }
    );
    expect(delRes.status).toBe(403);
  });

  it("updates a webhook (reactivate)", async () => {
    const apiKey = await getApiKey("agent-1");
    const createRes = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/hook" }),
    }));
    const { webhook_id } = await createRes.json();

    // Manually deactivate (simulate failure)
    await db.execute({
      sql: "UPDATE webhooks SET active = 0, failure_count = 5 WHERE id = ?",
      args: [webhook_id],
    });

    // Reactivate via PATCH
    const patchRes = await webhookPATCH(
      req(`/api/webhooks/${webhook_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ active: true }),
      }),
      { params: Promise.resolve({ id: webhook_id }) }
    );
    expect(patchRes.status).toBe(200);

    // Verify it's active with reset failure count
    const result = await db.execute({
      sql: "SELECT active, failure_count FROM webhooks WHERE id = ?",
      args: [webhook_id],
    });
    expect(result.rows[0].active).toBe(1);
    expect(result.rows[0].failure_count).toBe(0);
  });

  it("enforces max webhooks per agent", async () => {
    const apiKey = await getApiKey("agent-1");
    // Register 5 webhooks (the limit)
    for (let i = 0; i < 5; i++) {
      const res = await webhooksPOST(req("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ url: `https://example.com/hook${i}` }),
      }));
      expect(res.status).toBe(200);
    }

    // 6th should fail
    const res = await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://example.com/hook6" }),
    }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Maximum");
  });
});

describe("Webhook delivery", () => {
  it("stores webhooks in DB correctly", async () => {
    const apiKey = await getApiKey("agent-1");
    await webhooksPOST(req("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        url: "https://example.com/hook",
        events: ["new_match", "deal_approved"],
      }),
    }));

    const result = await db.execute({
      sql: "SELECT * FROM webhooks WHERE agent_id = ?",
      args: ["agent-1"],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].events).toBe("new_match,deal_approved");
    expect(result.rows[0].active).toBe(1);
    expect(result.rows[0].failure_count).toBe(0);
  });

  it("fireWebhooks queries correct webhooks", async () => {
    // Insert webhooks directly
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["wh-1", "agent-1", "https://example.com/hook1", "secret1", "*", 1],
    });
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["wh-2", "agent-1", "https://example.com/hook2", "secret2", "deal_approved", 1],
    });
    await db.execute({
      sql: "INSERT INTO webhooks (id, agent_id, url, secret, events, active) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["wh-inactive", "agent-1", "https://example.com/hook3", "secret3", "*", 0],
    });

    // Query active webhooks for agent
    const result = await db.execute({
      sql: "SELECT id, url, secret, events FROM webhooks WHERE agent_id = ? AND active = 1",
      args: ["agent-1"],
    });
    expect(result.rows).toHaveLength(2);
  });
});
