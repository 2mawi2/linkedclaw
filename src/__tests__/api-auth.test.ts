import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb } from "@/lib/db";
import type Database from "better-sqlite3";
import { POST as keysPOST } from "@/app/api/keys/route";
import { POST as connectPOST } from "@/app/api/connect/route";
import { authenticateRequest, hashKey } from "@/lib/auth";
import { NextRequest } from "next/server";

let db: Database.Database;
let restore: () => void;

beforeEach(() => {
  db = createTestDb();
  restore = _setDb(db);
});

afterEach(() => {
  restore();
  db.close();
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
  const res = await keysPOST(jsonReq("/api/keys", { agent_id: agentId }));
  const data = await res.json();
  return data.api_key;
}

describe("POST /api/keys", () => {
  it("generates an API key with lc_ prefix", async () => {
    const res = await keysPOST(jsonReq("/api/keys", { agent_id: "test-agent" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.api_key).toMatch(/^lc_[a-f0-9]{32}$/);
    expect(data.agent_id).toBe("test-agent");
  });

  it("stores hashed key in database", async () => {
    const res = await keysPOST(jsonReq("/api/keys", { agent_id: "test-agent" }));
    const data = await res.json();

    const hashed = hashKey(data.api_key);
    const row = db.prepare("SELECT * FROM api_keys WHERE key = ?").get(hashed) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.agent_id).toBe("test-agent");
    expect(row.last_used_at).toBeNull();
  });

  it("generates unique keys", async () => {
    const r1 = await keysPOST(jsonReq("/api/keys", { agent_id: "agent-a" }));
    const r2 = await keysPOST(jsonReq("/api/keys", { agent_id: "agent-b" }));
    const d1 = await r1.json();
    const d2 = await r2.json();
    expect(d1.api_key).not.toBe(d2.api_key);
  });

  it("rejects missing agent_id", async () => {
    const res = await keysPOST(jsonReq("/api/keys", {}));
    expect(res.status).toBe(400);
  });
});

describe("authenticateRequest", () => {
  it("returns agent_id for valid key", async () => {
    const apiKey = await getApiKey("alice");
    const req = jsonReq("/test", undefined, apiKey);
    const auth = authenticateRequest(req);
    expect(auth).not.toBeNull();
    expect(auth!.agent_id).toBe("alice");
  });

  it("returns null for missing header", () => {
    const req = new NextRequest("http://localhost:3000/test");
    expect(authenticateRequest(req)).toBeNull();
  });

  it("returns null for invalid key", () => {
    const req = jsonReq("/test", undefined, "lc_0000000000000000000000000000dead");
    expect(authenticateRequest(req)).toBeNull();
  });

  it("returns null for non-Bearer auth", () => {
    const req = new NextRequest("http://localhost:3000/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(authenticateRequest(req)).toBeNull();
  });

  it("updates last_used_at on successful auth", async () => {
    const apiKey = await getApiKey("test-agent");
    const hashed = hashKey(apiKey);

    const before = db.prepare("SELECT last_used_at FROM api_keys WHERE key = ?").get(hashed) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();

    authenticateRequest(jsonReq("/test", undefined, apiKey));

    const after = db.prepare("SELECT last_used_at FROM api_keys WHERE key = ?").get(hashed) as { last_used_at: string | null };
    expect(after.last_used_at).not.toBeNull();
  });
});

describe("auth enforcement on endpoints", () => {
  it("rejects unauthenticated POST /api/connect", async () => {
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "dev",
      params: { skills: ["ts"] },
    }));
    expect(res.status).toBe(401);
  });

  it("rejects mismatched agent_id", async () => {
    const apiKey = await getApiKey("alice");
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "bob", side: "offering", category: "dev",
      params: { skills: ["ts"] },
    }, apiKey));
    expect(res.status).toBe(403);
  });

  it("allows authenticated request with matching agent_id", async () => {
    const apiKey = await getApiKey("alice");
    const res = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "dev",
      params: { skills: ["ts"] },
    }, apiKey));
    expect(res.status).toBe(200);
  });
});
