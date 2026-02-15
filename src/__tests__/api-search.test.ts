import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { GET as searchGET } from "@/app/api/search/route";
import { PATCH as profilePATCH } from "@/app/api/profiles/[profileId]/route";
import { POST as reviewPOST } from "@/app/api/reputation/[agentId]/review/route";
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
  const req = new NextRequest("http://localhost:3000/api/keys", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await keysPOST(req);
  const data = await res.json();
  return data.api_key;
}

async function registerProfile(agentId: string, apiKey: string, overrides: Record<string, unknown> = {}) {
  const body = {
    agent_id: agentId,
    side: "offering",
    category: "freelance-dev",
    params: { skills: ["typescript", "react"], rate_min: 80, rate_max: 120, currency: "EUR" },
    description: "Full-stack developer specializing in React and TypeScript",
    ...overrides,
  };
  const req = new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
  });
  const res = await connectPOST(req);
  return res.json();
}

function searchRequest(params: Record<string, string> = {}): NextRequest {
  const query = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost:3000/api/search${query ? `?${query}` : ""}`);
}

describe("GET /api/search", () => {
  it("returns valid response shape with default search", async () => {
    const res = await searchGET(searchRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("profiles");
    expect(data).toHaveProperty("limit", 20);
    expect(data).toHaveProperty("offset", 0);
    expect(Array.isArray(data.profiles)).toBe(true);
  });

  it("returns registered profiles in search", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    await registerProfile("agent-1", key1, { category: "test-search-all" });
    await registerProfile("agent-2", key2, { category: "test-search-all", params: { skills: ["docker"] } });

    const res = await searchGET(searchRequest({ category: "test-search-all" }));
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.profiles).toHaveLength(2);
  });

  it("filters by category", async () => {
    const key1 = await getApiKey("agent-1");
    await registerProfile("agent-1", key1, { category: "test-unique-category" });

    const res = await searchGET(searchRequest({ category: "test-unique-category" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.profiles[0].agent_id).toBe("agent-1");
  });

  it("filters by side", async () => {
    const key1 = await getApiKey("agent-1");
    await registerProfile("agent-1", key1, { side: "offering", category: "test-side-filter" });
    const key2 = await getApiKey("agent-2");
    await registerProfile("agent-2", key2, { side: "seeking", category: "test-side-filter" });

    // Filter by both category and side to isolate from seed data
    const res = await searchGET(searchRequest({ side: "offering", category: "test-side-filter" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.profiles[0].agent_id).toBe("agent-1");
  });

  it("rejects invalid side parameter", async () => {
    const res = await searchGET(searchRequest({ side: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("filters by skill", async () => {
    const key1 = await getApiKey("agent-1");
    await registerProfile("agent-1", key1, { category: "test-skill-filter", params: { skills: ["uniqueskill123"] } });
    const key2 = await getApiKey("agent-2");
    await registerProfile("agent-2", key2, { category: "test-skill-filter", params: { skills: ["python", "django"] } });

    const res = await searchGET(searchRequest({ skill: "uniqueskill123", category: "test-skill-filter" }));
    const data = await res.json();
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].agent_id).toBe("agent-1");
  });

  it("filters by free-text query", async () => {
    const key1 = await getApiKey("agent-1");
    await registerProfile("agent-1", key1, { description: "Expert in quantum teleportation devices" });

    const res = await searchGET(searchRequest({ q: "quantum teleportation" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.profiles[0].agent_id).toBe("agent-1");
  });

  it("excludes agent with exclude_agent", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    await registerProfile("agent-1", key1, { category: "test-exclude" });
    await registerProfile("agent-2", key2, { category: "test-exclude" });

    const res = await searchGET(searchRequest({ exclude_agent: "agent-1", category: "test-exclude" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.profiles[0].agent_id).toBe("agent-2");
  });

  it("filters by availability", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const p1 = await registerProfile("agent-1", key1, { category: "test-avail" });
    await registerProfile("agent-2", key2, { category: "test-avail" });

    // Set agent-1 to busy via PATCH
    const patchReq = new NextRequest(`http://localhost:3000/api/profiles/${p1.profile_id}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_id: "agent-1", availability: "busy" }),
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key1}` },
    });
    const patchRes = await profilePATCH(patchReq, { params: Promise.resolve({ profileId: p1.profile_id }) });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.availability).toBe("busy");

    // Busy filter in test-avail should find only agent-1
    const busyRes = await searchGET(searchRequest({ availability: "busy", category: "test-avail" }));
    const busyData = await busyRes.json();
    expect(busyData.total).toBe(1);
    expect(busyData.profiles[0].agent_id).toBe("agent-1");

    // Available filter in test-avail should find only agent-2
    const availRes = await searchGET(searchRequest({ availability: "available", category: "test-avail" }));
    const availData = await availRes.json();
    expect(availData.total).toBe(1);
    expect(availData.profiles[0].agent_id).toBe("agent-2");
  });

  it("rejects invalid availability parameter", async () => {
    const res = await searchGET(searchRequest({ availability: "offline" }));
    expect(res.status).toBe(400);
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      const key = await getApiKey(`agent-${i}`);
      await registerProfile(`agent-${i}`, key, { category: "test-pagination" });
    }

    const res = await searchGET(searchRequest({ limit: "2", offset: "1", category: "test-pagination" }));
    const data = await res.json();
    expect(data.profiles).toHaveLength(2);
    expect(data.limit).toBe(2);
    expect(data.offset).toBe(1);
    expect(data.total).toBe(5);
  });

  it("clamps limit to max 100", async () => {
    const res = await searchGET(searchRequest({ limit: "999" }));
    const data = await res.json();
    expect(data.limit).toBe(100);
  });

  it("includes response fields: skills, rate_range, availability, reputation, tags", async () => {
    const key = await getApiKey("agent-1");
    await registerProfile("agent-1", key);

    const res = await searchGET(searchRequest());
    const data = await res.json();
    const p = data.profiles[0];
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("agent_id");
    expect(p).toHaveProperty("side");
    expect(p).toHaveProperty("category");
    expect(p).toHaveProperty("skills");
    expect(p).toHaveProperty("rate_range");
    expect(p).toHaveProperty("availability");
    expect(p).toHaveProperty("reputation");
    expect(p).toHaveProperty("tags");
    expect(p).toHaveProperty("description");
    expect(p).toHaveProperty("created_at");
    expect(p.reputation).toHaveProperty("avg_rating");
    expect(p.reputation).toHaveProperty("total_reviews");
  });

  it("combines multiple filters", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const key3 = await getApiKey("agent-3");
    await registerProfile("agent-1", key1, { side: "offering", category: "test-combo", params: { skills: ["uniquecombo"] } });
    await registerProfile("agent-2", key2, { side: "offering", category: "test-other", params: { skills: ["docker"] } });
    await registerProfile("agent-3", key3, { side: "seeking", category: "test-combo", params: { skills: ["uniquecombo"] } });

    const res = await searchGET(searchRequest({ category: "test-combo", side: "offering", skill: "uniquecombo" }));
    const data = await res.json();
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].agent_id).toBe("agent-1");
  });
});
