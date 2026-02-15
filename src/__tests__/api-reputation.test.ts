import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { GET as reputationGET } from "@/app/api/reputation/[agentId]/route";
import { POST as reviewPOST } from "@/app/api/reputation/[agentId]/review/route";
import { GET as summaryGET } from "@/app/api/agents/[agentId]/summary/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

async function getApiKey(agentId: string): Promise<string> { return createApiKey(agentId); }

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

/** Create two profiles, match them, propose, and approve from both sides. */
async function createApprovedDeal(): Promise<{ offeringId: string; seekingId: string; matchId: string }> {
  const r1 = await connectPOST(jsonReq("/api/connect", {
    agent_id: "alice", side: "offering", category: "dev",
    params: { skills: ["react", "ts"], rate_min: 50, rate_max: 70 },
  }, aliceKey));
  const { profile_id: offeringId } = await r1.json();

  const r2 = await connectPOST(jsonReq("/api/connect", {
    agent_id: "bob", side: "seeking", category: "dev",
    params: { skills: ["react"], rate_min: 40, rate_max: 60 },
  }, bobKey));
  const { profile_id: seekingId } = await r2.json();

  const matchRes = await matchesGET(
    jsonReq(`/api/matches/${offeringId}`),
    { params: Promise.resolve({ profileId: offeringId }) }
  );
  const { matches } = await matchRes.json();
  const matchId = matches[0].match_id;

  // Proposal (moves to 'proposed')
  await messagesPOST(
    jsonReq(`/api/deals/${matchId}/messages`, {
      agent_id: "alice", content: "Offer terms", message_type: "proposal",
      proposed_terms: { rate: 55 },
    }, aliceKey),
    { params: Promise.resolve({ matchId }) }
  );

  // Both approve
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
    { params: Promise.resolve({ matchId }) }
  );
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
    { params: Promise.resolve({ matchId }) }
  );

  return { offeringId, seekingId, matchId };
}

// ─── POST /api/reputation/:agentId/review ───────────────────────────

describe("POST /api/reputation/:agentId/review", () => {
  it("submits a review for an approved deal", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5, comment: "Great agent!" }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rating).toBe(5);
    expect(data.reviewer_agent_id).toBe("alice");
    expect(data.reviewed_agent_id).toBe("bob");
    expect(data.comment).toBe("Great agent!");
    expect(data.id).toBeTruthy();
  });

  it("allows review without comment", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 3 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment).toBeNull();
  });

  it("blocks duplicate reviews", async () => {
    const { matchId } = await createApprovedDeal();

    await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 3 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(409);
  });

  it("blocks unauthorized requests", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5 }),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(401);
  });

  it("only allows reviews for approved deals", async () => {
    // Create match but don't approve
    const r1 = await connectPOST(jsonReq("/api/connect", {
      agent_id: "alice", side: "offering", category: "design",
      params: { skills: ["figma"], rate_min: 30, rate_max: 50 },
    }, aliceKey));
    const { profile_id: offeringId } = await r1.json();

    await connectPOST(jsonReq("/api/connect", {
      agent_id: "bob", side: "seeking", category: "design",
      params: { skills: ["figma"], rate_min: 20, rate_max: 40 },
    }, bobKey));

    const matchRes = await matchesGET(
      jsonReq(`/api/matches/${offeringId}`),
      { params: Promise.resolve({ profileId: offeringId }) }
    );
    const { matches } = await matchRes.json();
    const matchId = matches[0].match_id;

    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("approved");
  });

  it("validates rating range", async () => {
    const { matchId } = await createApprovedDeal();

    for (const bad of [0, 6, 3.5, -1]) {
      const res = await reviewPOST(
        jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: bad }, aliceKey),
        { params: Promise.resolve({ agentId: "bob" }) }
      );
      expect(res.status).toBe(400);
    }
  });

  it("prevents self-reviews", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await reviewPOST(
      jsonReq("/api/reputation/alice/review", { match_id: matchId, rating: 5 }, aliceKey),
      { params: Promise.resolve({ agentId: "alice" }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("yourself");
  });

  it("blocks reviews from non-participants", async () => {
    const { matchId } = await createApprovedDeal();
    const charlieKey = await getApiKey("charlie");

    const res = await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5 }, charlieKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(403);
  });
});

// ─── GET /api/reputation/:agentId ───────────────────────────────────

describe("GET /api/reputation/:agentId", () => {
  it("returns empty reputation for agent with no reviews", async () => {
    const res = await reputationGET(
      jsonReq("/api/reputation/alice"),
      { params: Promise.resolve({ agentId: "alice" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent_id).toBe("alice");
    expect(data.avg_rating).toBe(0);
    expect(data.total_reviews).toBe(0);
    expect(data.rating_breakdown).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(data.recent_reviews).toEqual([]);
  });

  it("returns correct reputation after reviews", async () => {
    const { matchId } = await createApprovedDeal();

    await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 4, comment: "Good" }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );

    const res = await reputationGET(
      jsonReq("/api/reputation/bob"),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent_id).toBe("bob");
    expect(data.avg_rating).toBe(4);
    expect(data.total_reviews).toBe(1);
    expect(data.rating_breakdown[4]).toBe(1);
    expect(data.recent_reviews).toHaveLength(1);
    expect(data.recent_reviews[0].comment).toBe("Good");
    expect(data.recent_reviews[0].reviewer_agent_id).toBe("alice");
  });
});

// ─── Integration: reputation in summary ─────────────────────────────

describe("GET /api/agents/:agentId/summary (reputation)", () => {
  it("includes reputation in agent summary", async () => {
    const { matchId } = await createApprovedDeal();

    await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 5 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );

    const res = await summaryGET(
      jsonReq("/api/agents/bob/summary"),
      { params: Promise.resolve({ agentId: "bob" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reputation).toBeDefined();
    expect(data.reputation.avg_rating).toBe(5);
    expect(data.reputation.total_reviews).toBe(1);
  });
});

// ─── Integration: reputation in match results ───────────────────────

describe("GET /api/matches/:profileId (counterpart reputation)", () => {
  it("includes counterpart reputation in match results", async () => {
    const { matchId } = await createApprovedDeal();

    // Alice reviews Bob (rating 4)
    await reviewPOST(
      jsonReq("/api/reputation/bob/review", { match_id: matchId, rating: 4 }, aliceKey),
      { params: Promise.resolve({ agentId: "bob" }) }
    );

    // New match where charlie sees bob as counterpart
    const charlieKey = await getApiKey("charlie");
    const r1 = await connectPOST(jsonReq("/api/connect", {
      agent_id: "charlie", side: "offering", category: "qa",
      params: { skills: ["testing"], rate_min: 30, rate_max: 50 },
    }, charlieKey));
    const { profile_id: charlieProfileId } = await r1.json();

    await connectPOST(jsonReq("/api/connect", {
      agent_id: "bob", side: "seeking", category: "qa",
      params: { skills: ["testing"], rate_min: 20, rate_max: 40 },
    }, bobKey));

    const matchRes = await matchesGET(
      jsonReq(`/api/matches/${charlieProfileId}`),
      { params: Promise.resolve({ profileId: charlieProfileId }) }
    );
    const data = await matchRes.json();
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].counterpart_reputation).toBeDefined();
    expect(data.matches[0].counterpart_reputation.avg_rating).toBe(4);
    expect(data.matches[0].counterpart_reputation.total_reviews).toBe(1);
  });
});
