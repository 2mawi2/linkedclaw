import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { GET as ratesGET } from "@/app/api/rates/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

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

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await getApiKey("alice");
  bobKey = await getApiKey("bob");
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

async function createApprovedDeal(
  offeringAgent: string,
  seekingAgent: string,
  category: string,
  offeringParams: Record<string, unknown>,
  seekingParams: Record<string, unknown>,
  proposedTerms: Record<string, unknown>,
  oKey: string,
  sKey: string,
): Promise<string> {
  const r1 = await connectPOST(jsonReq("/api/connect", {
    agent_id: offeringAgent, side: "offering", category,
    params: offeringParams,
  }, oKey));
  const { profile_id: offeringId } = await r1.json();

  const r2 = await connectPOST(jsonReq("/api/connect", {
    agent_id: seekingAgent, side: "seeking", category,
    params: seekingParams,
  }, sKey));
  const { profile_id: seekingId } = await r2.json();

  const matchRes = await matchesGET(
    jsonReq(`/api/matches/${offeringId}`),
    { params: Promise.resolve({ profileId: offeringId }) },
  );
  const { matches } = await matchRes.json();
  const matchId = matches[0].match_id;

  // Send proposal
  await messagesPOST(
    jsonReq(`/api/deals/${matchId}/messages`, {
      agent_id: offeringAgent, content: "Proposal",
      message_type: "proposal", proposed_terms: proposedTerms,
    }, oKey),
    { params: Promise.resolve({ matchId }) },
  );

  // Both approve
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: offeringAgent, approved: true }, oKey),
    { params: Promise.resolve({ matchId }) },
  );
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: seekingAgent, approved: true }, sKey),
    { params: Promise.resolve({ matchId }) },
  );

  return matchId;
}

describe("GET /api/rates", () => {
  it("returns 400 when category is missing", async () => {
    const res = await ratesGET(jsonReq("/api/rates"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("category");
  });

  it("returns 400 when category is empty", async () => {
    const res = await ratesGET(jsonReq("/api/rates?category="));
    expect(res.status).toBe(400);
  });

  it("returns zero results for category with no deals", async () => {
    const res = await ratesGET(jsonReq("/api/rates?category=nonexistent"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_deals).toBe(0);
    expect(data.median_rate).toBeNull();
    expect(data.avg_rate).toBeNull();
    expect(data.min_rate).toBeNull();
    expect(data.max_rate).toBeNull();
    expect(data.by_skill).toEqual([]);
    expect(data.category).toBe("nonexistent");
  });

  it("returns aggregated rates for approved deals", async () => {
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react", "ts"], rate_min: 40, rate_max: 80 },
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { rate: 60 },
      aliceKey, bobKey,
    );

    const res = await ratesGET(jsonReq("/api/rates?category=dev"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.category).toBe("dev");
    expect(data.total_deals).toBe(1);
    expect(data.median_rate).toBe(60);
    expect(data.avg_rate).toBe(60);
    expect(data.min_rate).toBe(60);
    expect(data.max_rate).toBe(60);
  });

  it("computes correct stats for multiple deals", async () => {
    // Create first approved deal
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react"], rate_min: 40, rate_max: 100 },
      { skills: ["react"], rate_min: 40, rate_max: 100 },
      { rate: 50 },
      aliceKey, bobKey,
    );

    // Insert a second approved deal directly for clean isolation
    const matchId2 = "test-match-2";
    const profC = "prof-c";
    const profD = "prof-d";
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)",
      args: [profC, "charlie", "offering", "dev", JSON.stringify({ skills: ["react"], rate_min: 40, rate_max: 100 })],
    });
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)",
      args: [profD, "dave", "seeking", "dev", JSON.stringify({ skills: ["react"], rate_min: 40, rate_max: 100 })],
    });
    await db.execute({
      sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, 'approved')",
      args: [matchId2, profC, profD, JSON.stringify({ matching_skills: ["react"], score: 80 })],
    });
    await db.execute({
      sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type, proposed_terms) VALUES (?, ?, ?, 'proposal', ?)",
      args: [matchId2, "charlie", "Offer", JSON.stringify({ rate: 100 })],
    });

    const res = await ratesGET(jsonReq("/api/rates?category=dev"));
    const data = await res.json();
    expect(data.total_deals).toBe(2);
    expect(data.median_rate).toBe(75);
    expect(data.avg_rate).toBe(75);
    expect(data.min_rate).toBe(50);
    expect(data.max_rate).toBe(100);
  });

  it("provides by_skill breakdown", async () => {
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react", "ts"], rate_min: 40, rate_max: 80 },
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { rate: 60 },
      aliceKey, bobKey,
    );

    const res = await ratesGET(jsonReq("/api/rates?category=dev"));
    const data = await res.json();
    expect(data.by_skill.length).toBeGreaterThan(0);
    const reactSkill = data.by_skill.find((s: { skill: string }) => s.skill === "react");
    expect(reactSkill).toBeDefined();
    expect(reactSkill.median_rate).toBe(60);
    expect(reactSkill.total_deals).toBe(1);
  });

  it("filters by skill query param", async () => {
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react", "ts"], rate_min: 40, rate_max: 80 },
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { rate: 60 },
      aliceKey, bobKey,
    );

    // Filter by react - should include
    const res = await ratesGET(jsonReq("/api/rates?category=dev&skill=react"));
    const data = await res.json();
    expect(data.total_deals).toBe(1);
    expect(data.skill).toBe("react");

    // Filter by python - should exclude
    const res2 = await ratesGET(jsonReq("/api/rates?category=dev&skill=python"));
    const data2 = await res2.json();
    expect(data2.total_deals).toBe(0);
  });

  it("ignores non-approved deals", async () => {
    // Create a match with a proposal but don't approve it
    const r1 = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "dev",
      params: { skills: ["react"], rate_min: 40, rate_max: 80 },
    }, aliceKey));
    const { profile_id: offeringId } = await r1.json();

    const r2 = await connectPOST(jsonReq("/api/connect", {
      agent_id: "bob", side: "seeking", category: "dev",
      params: { skills: ["react"], rate_min: 40, rate_max: 80 },
    }, bobKey));
    await r2.json();

    const matchRes = await matchesGET(
      jsonReq(`/api/matches/${offeringId}`),
      { params: Promise.resolve({ profileId: offeringId }) },
    );
    const { matches } = await matchRes.json();
    const matchId = matches[0].match_id;

    // Send proposal but don't approve
    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Proposal",
        message_type: "proposal", proposed_terms: { rate: 999 },
      }, aliceKey),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await ratesGET(jsonReq("/api/rates?category=dev"));
    const data = await res.json();
    expect(data.total_deals).toBe(0);
  });

  it("ignores proposals with no rate field", async () => {
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { hours: 20, description: "no rate here" },
      aliceKey, bobKey,
    );

    const res = await ratesGET(jsonReq("/api/rates?category=dev"));
    const data = await res.json();
    expect(data.total_deals).toBe(0);
  });

  it("does not include rates from a different category", async () => {
    await createApprovedDeal(
      "alice", "bob", "dev",
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { skills: ["react"], rate_min: 40, rate_max: 80 },
      { rate: 60 },
      aliceKey, bobKey,
    );

    const res = await ratesGET(jsonReq("/api/rates?category=design"));
    const data = await res.json();
    expect(data.total_deals).toBe(0);
    expect(data.category).toBe("design");
  });
});
