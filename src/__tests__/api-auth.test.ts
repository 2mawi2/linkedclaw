import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { generateApiKey, hashApiKey, authenticateRequest, generateSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";
import { POST as keysPOST } from "@/app/api/keys/route";
import { POST as connectPOST } from "@/app/api/connect/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";

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

function jsonReq(url: string, body?: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

async function getApiKey(agentId: string): Promise<string> {
  const { raw, hash } = generateApiKey();
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [id, agentId, hash],
  });
  return raw;
}

describe("generateApiKey", () => {
  it("generates a key with lc_ prefix", () => {
    const { raw, hash } = generateApiKey();
    expect(raw).toMatch(/^lc_[a-f0-9]{32}$/);
    expect(hash).toHaveLength(64);
  });
});

describe("POST /api/keys", () => {
  it("generates an API key for authenticated agent", async () => {
    const existingKey = await getApiKey("test-agent");
    const res = await keysPOST(jsonReq("/api/keys", {}, existingKey));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.api_key).toMatch(/^lc_/);
    expect(data.agent_id).toBe("test-agent");
  });

  it("stores hashed key in database", async () => {
    const existingKey = await getApiKey("test-agent");
    const res = await keysPOST(jsonReq("/api/keys", {}, existingKey));
    const data = await res.json();
    const result = await db.execute({
      sql: "SELECT * FROM api_keys WHERE key_hash = ?",
      args: [hashApiKey(data.api_key)],
    });
    const row = result.rows[0];
    expect(row).toBeTruthy();
    expect(row.agent_id).toBe("test-agent");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await keysPOST(jsonReq("/api/keys", { agent_id: "test-agent" }));
    expect(res.status).toBe(401);
  });
});

describe("authenticateRequest", () => {
  it("returns agent_id for valid key", async () => {
    const apiKey = await getApiKey("alice");
    const auth = await authenticateRequest(jsonReq("/test", undefined, apiKey));
    expect(auth).not.toBeNull();
    expect(auth!.agent_id).toBe("alice");
  });

  it("returns null for missing header", async () => {
    const req = new NextRequest("http://localhost:3000/test");
    expect(await authenticateRequest(req)).toBeNull();
  });

  it("returns null for invalid key", async () => {
    expect(await authenticateRequest(jsonReq("/test", undefined, "lc_bad"))).toBeNull();
  });

  it("updates last_used_at", async () => {
    const apiKey = await getApiKey("agent");
    const keyHash = hashApiKey(apiKey);
    const beforeResult = await db.execute({
      sql: "SELECT last_used_at FROM api_keys WHERE key_hash = ?",
      args: [keyHash],
    });
    expect(beforeResult.rows[0].last_used_at).toBeNull();
    await authenticateRequest(jsonReq("/test", undefined, apiKey));
    const afterResult = await db.execute({
      sql: "SELECT last_used_at FROM api_keys WHERE key_hash = ?",
      args: [keyHash],
    });
    expect(afterResult.rows[0].last_used_at).not.toBeNull();
  });
});

describe("auth enforcement", () => {
  it("rejects unauthenticated POST /api/connect", async () => {
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "dev", params: { skills: ["ts"] },
    }));
    expect(res.status).toBe(401);
  });

  it("rejects mismatched agent_id", async () => {
    const apiKey = await getApiKey("alice");
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "bob", side: "offering", category: "dev", params: { skills: ["ts"] },
    }, apiKey));
    expect(res.status).toBe(403);
  });

  it("allows matching agent_id", async () => {
    const apiKey = await getApiKey("alice");
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "dev", params: { skills: ["ts"] },
    }, apiKey));
    expect(res.status).toBe(200);
  });

  it("allows session cookie auth for write endpoints", async () => {
    // Create a user + session in the DB (simulating login)
    const userId = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      args: [userId, "alice", "fakehash"],
    });
    const { raw: sessionToken, hash: tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
      args: [crypto.randomUUID(), userId, tokenHash, expiresAt],
    });

    // Build request with session cookie instead of Bearer token
    const req = new NextRequest("http://localhost:3000/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": `${SESSION_COOKIE_NAME}=${sessionToken}` },
      body: JSON.stringify({
        agent_id: "alice", side: "offering", category: "dev", params: { skills: ["ts"] },
      }),
    });

    const res = await connectPOST(req);
    expect(res.status).toBe(200);
  });
});
