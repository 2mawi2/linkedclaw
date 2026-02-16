import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate, ensureDb } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/rate-limits/route";
import { NextRequest } from "next/server";
import { generateApiKey, hashApiKey } from "@/lib/auth";
import { getRateLimitStats } from "@/lib/rate-limit";

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

async function createAgent(agentId: string): Promise<string> {
  const d = await ensureDb();
  const { raw, hash } = generateApiKey();
  await d.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [crypto.randomUUID(), agentId, hash],
  });
  return raw;
}

function req(apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest("http://localhost:3000/api/rate-limits", { headers });
}

describe("GET /api/rate-limits", () => {
  it("returns 401 without auth", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 200 with limits array when authenticated", async () => {
    const key = await createAgent("agent1");
    const res = await GET(req(key));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.limits)).toBe(true);
    expect(data.limits.length).toBeGreaterThan(0);
    expect(typeof data.note).toBe("string");
    expect(typeof data.ip_hash).toBe("string");
  });

  it("each limit entry has required fields", async () => {
    const key = await createAgent("agent2");
    const res = await GET(req(key));
    const data = await res.json();
    for (const limit of data.limits) {
      expect(typeof limit.prefix).toBe("string");
      expect(typeof limit.used).toBe("number");
      expect(typeof limit.limit).toBe("number");
      expect(typeof limit.windowMs).toBe("number");
      expect(typeof limit.remaining).toBe("number");
    }
  });

  it("shows all three rate limit categories", async () => {
    const key = await createAgent("agent3");
    const res = await GET(req(key));
    const data = await res.json();
    const prefixes = data.limits.map((l: { prefix: string }) => l.prefix);
    expect(prefixes).toContain("key_gen");
    expect(prefixes).toContain("write");
    expect(prefixes).toContain("read");
  });

  it("remaining equals limit when no usage", async () => {
    const key = await createAgent("agent4");
    const res = await GET(req(key));
    const data = await res.json();
    for (const limit of data.limits) {
      expect(limit.remaining).toBe(limit.limit);
      expect(limit.used).toBe(0);
    }
  });

  it("masks IP digits in response", async () => {
    const key = await createAgent("agent5");
    const res = await GET(req(key));
    const data = await res.json();
    // IP digits should be masked with *
    expect(data.ip_hash).not.toMatch(/\d/);
  });
});

describe("getRateLimitStats", () => {
  it("returns stats for all categories", () => {
    const stats = getRateLimitStats("192.168.1.1");
    expect(stats.length).toBe(3);
    for (const s of stats) {
      expect(s.used).toBe(0);
      expect(s.remaining).toBe(s.limit);
      expect(s.resetsAt).toBeNull();
    }
  });

  it("prefixes match RATE_LIMITS keys lowercased", () => {
    const stats = getRateLimitStats("10.0.0.1");
    const prefixes = stats.map((s) => s.prefix);
    expect(prefixes).toContain("key_gen");
    expect(prefixes).toContain("write");
    expect(prefixes).toContain("read");
  });
});
