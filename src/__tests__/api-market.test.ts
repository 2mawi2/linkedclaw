import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/market/[category]/route";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
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

async function createProfile(
  agentId: string,
  side: string,
  category: string,
  params: Record<string, unknown>,
  apiKey: string,
  description?: string
) {
  const req = new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify({
      agent_id: agentId,
      side,
      category,
      params,
      description: description ?? `${agentId} ${side} ${category}`,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return connectPOST(req);
}

function marketRequest(category: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/market/${category}`, {
    method: "GET",
  });
}

async function callMarket(category: string) {
  const res = await GET(marketRequest(category), {
    params: Promise.resolve({ category }),
  });
  return { status: res.status, data: await res.json() };
}

describe("GET /api/market/:category", () => {
  it("returns 404 for empty category", async () => {
    const { status, data } = await callMarket("nonexistent");
    expect(status).toBe(404);
    expect(data.error).toContain("No active profiles");
  });

  it("returns basic stats for a category", async () => {
    const key = await getApiKey("agent-a");
    await createProfile("agent-a", "offering", "dev", { skills: ["typescript", "react"], rate_min: 80, rate_max: 120, currency: "EUR" }, key);
    const key2 = await getApiKey("agent-b");
    await createProfile("agent-b", "seeking", "dev", { skills: ["typescript", "python"], rate_min: 60, rate_max: 100, currency: "EUR" }, key2);

    const { status, data } = await callMarket("dev");
    expect(status).toBe(200);
    expect(data.category).toBe("dev");
    expect(data.active_profiles).toBe(2);
    expect(data.offering_count).toBe(1);
    expect(data.seeking_count).toBe(1);
    expect(data.demand_ratio).toBe(1);
  });

  it("computes rate percentiles correctly", async () => {
    const agents = ["a", "b", "c", "d", "e"];
    const rates = [
      { rate_min: 40, rate_max: 60 },   // midpoint: 50
      { rate_min: 70, rate_max: 90 },   // midpoint: 80
      { rate_min: 90, rate_max: 110 },  // midpoint: 100
      { rate_min: 100, rate_max: 140 }, // midpoint: 120
      { rate_min: 180, rate_max: 220 }, // midpoint: 200
    ];

    for (let i = 0; i < agents.length; i++) {
      const key = await getApiKey(`agent-${agents[i]}`);
      await createProfile(`agent-${agents[i]}`, "offering", "consulting", { ...rates[i], currency: "EUR" }, key);
    }

    const { status, data } = await callMarket("consulting");
    expect(status).toBe(200);
    expect(data.rate_median).toBe(100); // middle of 5 sorted values
    expect(data.rate_p10).toBeDefined();
    expect(data.rate_p90).toBeDefined();
    expect(data.rate_count).toBe(5);
    expect(data.currency).toBe("EUR");
    // p10 should be near 50, p90 near 200
    expect(data.rate_p10).toBeLessThan(data.rate_median);
    expect(data.rate_p90).toBeGreaterThan(data.rate_median);
  });

  it("returns top skills sorted by frequency", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const key3 = await getApiKey("agent-3");
    await createProfile("agent-1", "offering", "dev", { skills: ["typescript", "react", "node"] }, key1);
    await createProfile("agent-2", "offering", "dev", { skills: ["typescript", "python"] }, key2);
    await createProfile("agent-3", "seeking", "dev", { skills: ["typescript", "react"] }, key3);

    const { data } = await callMarket("dev");
    expect(data.top_skills.length).toBe(4);
    // typescript should be #1 (3 profiles)
    expect(data.top_skills[0].skill).toBe("typescript");
    expect(data.top_skills[0].count).toBe(3);
    // react should be #2 (2 profiles)
    expect(data.top_skills[1].skill).toBe("react");
    expect(data.top_skills[1].count).toBe(2);
  });

  it("computes demand ratio correctly", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const key3 = await getApiKey("agent-3");
    await createProfile("agent-1", "offering", "design", {}, key1);
    await createProfile("agent-2", "seeking", "design", {}, key2);
    await createProfile("agent-3", "seeking", "design", {}, key3);

    const { data } = await callMarket("design");
    expect(data.demand_ratio).toBe(2); // 2 seekers / 1 offerer
  });

  it("handles profiles without rate params", async () => {
    const key = await getApiKey("agent-norates");
    await createProfile("agent-norates", "offering", "art", { skills: ["illustration"] }, key);

    const { data } = await callMarket("art");
    expect(data.active_profiles).toBe(1);
    expect(data.rate_median).toBeUndefined();
    expect(data.rate_p10).toBeUndefined();
    expect(data.top_skills[0].skill).toBe("illustration");
  });

  it("includes deal activity stats", async () => {
    const key = await getApiKey("agent-x");
    await createProfile("agent-x", "offering", "qa", {}, key);

    const { data } = await callMarket("qa");
    expect(data.deals_90d).toBeDefined();
    expect(data.deals_90d.total).toBe(0);
    expect(data.deals_90d.successful).toBe(0);
  });

  it("ignores inactive profiles", async () => {
    const key = await getApiKey("agent-active");
    await createProfile("agent-active", "offering", "ops", { rate_min: 50 }, key);

    // Deactivate via direct DB insert
    const key2 = await getApiKey("agent-inactive");
    await createProfile("agent-inactive", "seeking", "ops", { rate_min: 100 }, key2);
    await db.execute({ sql: "UPDATE profiles SET active = 0 WHERE agent_id = ?", args: ["agent-inactive"] });

    const { data } = await callMarket("ops");
    expect(data.active_profiles).toBe(1);
    expect(data.offering_count).toBe(1);
    expect(data.seeking_count).toBe(0);
  });

  it("handles rate_min only or rate_max only", async () => {
    const key1 = await getApiKey("agent-min");
    const key2 = await getApiKey("agent-max");
    await createProfile("agent-min", "offering", "data", { rate_min: 60 }, key1);
    await createProfile("agent-max", "seeking", "data", { rate_max: 100 }, key2);

    const { data } = await callMarket("data");
    expect(data.rate_count).toBe(2);
    expect(data.rate_median).toBe(80); // midpoint of [60, 100]
  });
});
