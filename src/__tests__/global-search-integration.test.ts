import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as bountyPOST } from "@/app/api/bounties/route";
import { GET as searchGET } from "@/app/api/search/route";
import { NextRequest } from "next/server";

/**
 * Integration tests for unified search (type=all) used by the GlobalSearch UI.
 */

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

async function setupData() {
  const keyA = await createApiKey("agent-search-ui");

  // Create a listing
  const connectRes = await connectPOST(
    new NextRequest("http://localhost/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify({
        agent_id: "agent-search-ui",
        side: "offering",
        category: "development",
        description: "Expert React and TypeScript developer",
        params: {
          skills: ["react", "typescript", "nextjs"],
          rate_min: 80,
          rate_max: 120,
          currency: "EUR",
        },
      }),
    }),
  );
  expect(connectRes.status).toBe(200);

  // Create a bounty
  const bountyRes = await bountyPOST(
    new NextRequest("http://localhost/api/bounties", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
      body: JSON.stringify({
        agent_id: "agent-search-ui",
        title: "Build a React dashboard with TypeScript",
        description: "Need a developer for a React + TypeScript project",
        category: "development",
        skills: ["react", "typescript"],
        budget_min: 2000,
        budget_max: 5000,
        currency: "EUR",
      }),
    }),
  );
  expect(bountyRes.status).toBe(201);

  return keyA;
}

function searchReq(params: string) {
  return new NextRequest(`http://localhost/api/search?${params}`, { method: "GET" });
}

describe("Global Search UI (type=all)", () => {
  it("returns both profiles and bounties for matching query", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&q=react&limit=5"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles).toBeDefined();
    expect(data.bounties).toBeDefined();
    expect(data.profiles_total).toBeGreaterThanOrEqual(1);
    expect(data.bounties_total).toBeGreaterThanOrEqual(1);
    expect(data.total).toBe(data.profiles_total + data.bounties_total);
  });

  it("returns empty results for non-matching query", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&q=xyznonexistent999&limit=5"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles.length).toBe(0);
    expect(data.bounties.length).toBe(0);
  });

  it("respects limit parameter", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&q=react&limit=1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles.length).toBeLessThanOrEqual(1);
    expect(data.bounties.length).toBeLessThanOrEqual(1);
  });

  it("profile results include fields needed by GlobalSearch component", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&q=react&limit=5"));
    const data = await res.json();
    const profile = data.profiles[0];
    expect(profile.id).toBeDefined();
    expect(profile.agent_id).toBeDefined();
    expect(profile.side).toBe("offering");
    expect(profile.category).toBe("development");
    expect(profile.skills).toBeInstanceOf(Array);
    expect(profile.description).toContain("React");
    expect(profile.rate_range).toBeDefined();
    expect(profile.rate_range.min).toBe(80);
    expect(profile.rate_range.max).toBe(120);
    expect(profile.rate_range.currency).toBe("EUR");
  });

  it("bounty results include fields needed by GlobalSearch component", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&q=react&limit=5"));
    const data = await res.json();
    const bounty = data.bounties[0];
    expect(bounty.id).toBeDefined();
    expect(bounty.title).toContain("React");
    expect(bounty.category).toBe("development");
    expect(bounty.currency).toBe("EUR");
    expect(bounty.budget_min).toBe(2000);
    expect(bounty.budget_max).toBe(5000);
  });

  it("category filter narrows both types", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&category=design&limit=5"));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Our data is all "development", so "design" should return nothing
    expect(data.profiles.length).toBe(0);
    expect(data.bounties.length).toBe(0);
  });

  it("search with no query returns all active results", async () => {
    await setupData();
    const res = await searchGET(searchReq("type=all&limit=10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profiles_total).toBeGreaterThanOrEqual(1);
    expect(data.bounties_total).toBeGreaterThanOrEqual(1);
  });
});
