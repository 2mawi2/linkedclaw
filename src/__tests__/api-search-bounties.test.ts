import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as bountyPOST } from "@/app/api/bounties/route";
import { GET as searchGET } from "@/app/api/search/route";
import { NextRequest } from "next/server";

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
  return createApiKey(agentId);
}

async function createBounty(
  apiKey: string,
  overrides: Record<string, unknown> = {},
) {
  const body = {
    agent_id: "bounty-creator",
    title: "Build a React dashboard",
    description: "Need a responsive admin dashboard with charts",
    category: "development",
    skills: ["react", "typescript"],
    budget_min: 500,
    budget_max: 2000,
    currency: "EUR",
    ...overrides,
  };
  const req = new NextRequest("http://localhost:3000/api/bounties", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const res = await bountyPOST(req);
  return res.json();
}

async function registerProfile(
  agentId: string,
  apiKey: string,
  overrides: Record<string, unknown> = {},
) {
  const body = {
    agent_id: agentId,
    side: "offering",
    category: "development",
    params: { skills: ["typescript", "react"], rate_min: 80, rate_max: 120, currency: "EUR" },
    description: "Full-stack developer",
    ...overrides,
  };
  const req = new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
  const res = await connectPOST(req);
  return res.json();
}

function searchRequest(params: Record<string, string> = {}): NextRequest {
  const query = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost:3000/api/search${query ? `?${query}` : ""}`);
}

describe("GET /api/search?type=bounties", () => {
  it("returns bounties when type=bounties", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, { agent_id: "creator-1", category: "sb-test" });

    const res = await searchGET(searchRequest({ type: "bounties", category: "sb-test" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("bounties");
    expect(data).toHaveProperty("total");
    expect(data.bounties).toHaveLength(1);
    expect(data.bounties[0].title).toBe("Build a React dashboard");
  });

  it("filters bounties by category", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, { agent_id: "creator-1", category: "design" });
    await createBounty(key, { agent_id: "creator-1", category: "development" });

    const res = await searchGET(searchRequest({ type: "bounties", category: "design" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].category).toBe("design");
  });

  it("filters bounties by free-text query", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, {
      agent_id: "creator-1",
      title: "Quantum computing simulator",
      category: "sb-q-test",
    });
    await createBounty(key, {
      agent_id: "creator-1",
      title: "Simple landing page",
      category: "sb-q-test",
    });

    const res = await searchGET(
      searchRequest({ type: "bounties", q: "quantum", category: "sb-q-test" }),
    );
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].title).toBe("Quantum computing simulator");
  });

  it("filters bounties by skill", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, {
      agent_id: "creator-1",
      skills: ["rust", "wasm"],
      category: "sb-skill-test",
    });
    await createBounty(key, {
      agent_id: "creator-1",
      skills: ["python", "django"],
      category: "sb-skill-test",
    });

    const res = await searchGET(
      searchRequest({ type: "bounties", skill: "rust", category: "sb-skill-test" }),
    );
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].skills).toContain("rust");
  });

  it("defaults to open bounties only", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, { agent_id: "creator-1", category: "sb-status-test" });

    // Manually set one bounty to cancelled
    await db.execute({
      sql: `UPDATE bounties SET status = 'cancelled' WHERE category = 'sb-status-test'`,
      args: [],
    });

    // Create another open one
    await createBounty(key, { agent_id: "creator-1", category: "sb-status-test" });

    const res = await searchGET(
      searchRequest({ type: "bounties", category: "sb-status-test" }),
    );
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].status).toBe("open");
  });

  it("bounty_status=any returns all statuses", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, { agent_id: "creator-1", category: "sb-any-test" });
    await createBounty(key, { agent_id: "creator-1", category: "sb-any-test" });

    // Cancel one
    const allRes = await db.execute({
      sql: `SELECT id FROM bounties WHERE category = 'sb-any-test' LIMIT 1`,
      args: [],
    });
    await db.execute({
      sql: `UPDATE bounties SET status = 'cancelled' WHERE id = ?`,
      args: [String(allRes.rows[0].id)],
    });

    const res = await searchGET(
      searchRequest({ type: "bounties", category: "sb-any-test", bounty_status: "any" }),
    );
    const data = await res.json();
    expect(data.total).toBe(2);
  });

  it("includes bounty response fields", async () => {
    const key = await getApiKey("creator-1");
    await createBounty(key, { agent_id: "creator-1", category: "sb-fields" });

    const res = await searchGET(searchRequest({ type: "bounties", category: "sb-fields" }));
    const data = await res.json();
    const b = data.bounties[0];
    expect(b).toHaveProperty("id");
    expect(b).toHaveProperty("creator_agent_id");
    expect(b).toHaveProperty("title");
    expect(b).toHaveProperty("description");
    expect(b).toHaveProperty("category");
    expect(b).toHaveProperty("skills");
    expect(b).toHaveProperty("budget_min");
    expect(b).toHaveProperty("budget_max");
    expect(b).toHaveProperty("currency");
    expect(b).toHaveProperty("status");
    expect(b).toHaveProperty("created_at");
  });

  it("respects limit and offset for bounties", async () => {
    const key = await getApiKey("creator-1");
    for (let i = 0; i < 5; i++) {
      await createBounty(key, {
        agent_id: "creator-1",
        title: `Bounty ${i}`,
        category: "sb-page-test",
      });
    }

    const res = await searchGET(
      searchRequest({ type: "bounties", limit: "2", offset: "1", category: "sb-page-test" }),
    );
    const data = await res.json();
    expect(data.bounties).toHaveLength(2);
    expect(data.limit).toBe(2);
    expect(data.offset).toBe(1);
    expect(data.total).toBe(5);
  });
});

describe("GET /api/search?type=all", () => {
  it("returns both profiles and bounties", async () => {
    const key = await getApiKey("agent-1");
    await registerProfile("agent-1", key, { category: "sb-all-test" });
    await createBounty(key, { agent_id: "agent-1", category: "sb-all-test" });

    const res = await searchGET(
      searchRequest({ type: "all", category: "sb-all-test" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("profiles");
    expect(data).toHaveProperty("bounties");
    expect(data).toHaveProperty("profiles_total");
    expect(data).toHaveProperty("bounties_total");
    expect(data).toHaveProperty("total");
    expect(data.profiles).toHaveLength(1);
    expect(data.bounties).toHaveLength(1);
    expect(data.total).toBe(2);
  });

  it("q parameter searches across both profiles and bounties", async () => {
    const key = await getApiKey("agent-1");
    await registerProfile("agent-1", key, {
      description: "Quantum computing specialist",
      category: "sb-cross-test",
    });
    await createBounty(key, {
      agent_id: "agent-1",
      title: "Quantum entanglement project",
      category: "sb-cross-test",
    });

    const res = await searchGET(
      searchRequest({ type: "all", q: "quantum", category: "sb-cross-test" }),
    );
    const data = await res.json();
    expect(data.profiles).toHaveLength(1);
    expect(data.bounties).toHaveLength(1);
    expect(data.total).toBe(2);
  });

  it("returns empty results when nothing matches", async () => {
    const res = await searchGET(
      searchRequest({ type: "all", q: "nonexistent-gibberish-xyz-123" }),
    );
    const data = await res.json();
    expect(data.profiles).toHaveLength(0);
    expect(data.bounties).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});

describe("GET /api/search type validation", () => {
  it("rejects invalid type parameter", async () => {
    const res = await searchGET(searchRequest({ type: "invalid" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("type");
  });

  it("defaults to profiles when no type specified", async () => {
    const res = await searchGET(searchRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should have profiles array (backward compat), no bounties
    expect(data).toHaveProperty("profiles");
    expect(data).not.toHaveProperty("bounties");
  });
});
