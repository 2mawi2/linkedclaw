import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as dealsPOST } from "@/app/api/deals/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { GET as compareGET } from "@/app/api/deals/compare/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;
let charlieKey: string;
let daveKey: string;

async function getApiKey(agentId: string): Promise<string> {
  return createApiKey(agentId);
}

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await getApiKey("alice");
  bobKey = await getApiKey("bob");
  charlieKey = await getApiKey("charlie");
  daveKey = await getApiKey("dave");
});

afterEach(() => {
  restore();
});

function jsonReq(
  url: string,
  body?: unknown,
  apiKey?: string,
  method?: string,
): NextRequest {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: method ?? (body ? "POST" : "GET"),
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

async function createListing(
  apiKey: string,
  agentId: string,
  side: string,
  skills: string[],
) {
  const res = await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: agentId,
        side,
        category: "engineering",
        params: { skills, rate_min: 50, rate_max: 120 },
      },
      apiKey,
    ),
  );
  const data = await res.json();
  return data.profile_id;
}

async function createDeal(
  apiKey: string,
  agentId: string,
  counterpartId: string,
  msg?: string,
) {
  const res = await dealsPOST(
    jsonReq(
      "/api/deals",
      {
        agent_id: agentId,
        counterpart_agent_id: counterpartId,
        message: msg,
      },
      apiKey,
    ),
  );
  const data = await res.json();
  return data.match_id;
}

async function sendProposal(
  apiKey: string,
  matchId: string,
  agentId: string,
  content: string,
  terms: Record<string, unknown>,
) {
  return messagesPOST(
    jsonReq(
      `/api/deals/${matchId}/messages`,
      {
        agent_id: agentId,
        content,
        message_type: "proposal",
        proposed_terms: terms,
      },
      apiKey,
    ),
    { params: Promise.resolve({ matchId }) },
  );
}

describe("Deal Comparison API", () => {
  let matchId1: string;
  let matchId2: string;
  let matchId3: string;

  beforeEach(async () => {
    // Create listings
    await createListing(aliceKey, "alice", "offering", ["react", "node"]);
    await createListing(bobKey, "bob", "seeking", ["react"]);
    await createListing(charlieKey, "charlie", "seeking", ["react", "node"]);
    await createListing(daveKey, "dave", "seeking", ["node"]);

    // Create 3 deals from alice
    matchId1 = await createDeal(aliceKey, "alice", "bob", "Hi Bob");
    matchId2 = await createDeal(aliceKey, "alice", "charlie", "Hi Charlie");
    matchId3 = await createDeal(aliceKey, "alice", "dave", "Hi Dave");

    // Bob sends a proposal on deal 1
    await sendProposal(bobKey, matchId1, "bob", "Proposing 90/hr", {
      rate: 90,
      currency: "EUR",
      hours_per_week: 40,
    });

    // Charlie sends a proposal on deal 2
    await sendProposal(charlieKey, matchId2, "charlie", "Proposing 110/hr", {
      rate: 110,
      currency: "EUR",
      hours_per_week: 30,
    });
    // Deal 3 has no proposal
  });

  it("compares two deals with proposals", async () => {
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1},${matchId2}`, undefined, aliceKey),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);
    expect(data.comparisons).toHaveLength(2);

    const deal1 = data.comparisons.find(
      (c: Record<string, unknown>) => c.match_id === matchId1,
    );
    const deal2 = data.comparisons.find(
      (c: Record<string, unknown>) => c.match_id === matchId2,
    );

    expect(deal1).toBeDefined();
    expect(deal2).toBeDefined();
    expect(deal1.counterpart_agent_id).toBe("bob");
    expect(deal2.counterpart_agent_id).toBe("charlie");

    expect(deal1.latest_proposal).not.toBeNull();
    expect(deal1.latest_proposal.proposed_terms.rate).toBe(90);
    expect(deal2.latest_proposal).not.toBeNull();
    expect(deal2.latest_proposal.proposed_terms.rate).toBe(110);
  });

  it("includes deal without proposal", async () => {
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1},${matchId3}`, undefined, aliceKey),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(2);

    const deal3 = data.comparisons.find(
      (c: Record<string, unknown>) => c.match_id === matchId3,
    );
    expect(deal3).toBeDefined();
    expect(deal3.latest_proposal).toBeNull();
    expect(deal3.counterpart_agent_id).toBe("dave");
  });

  it("compares three deals at once", async () => {
    const res = await compareGET(
      jsonReq(
        `/api/deals/compare?match_ids=${matchId1},${matchId2},${matchId3}`,
        undefined,
        aliceKey,
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(3);
    expect(data.comparisons).toHaveLength(3);
  });

  it("requires authentication", async () => {
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1},${matchId2}`),
    );
    expect(res.status).toBe(401);
  });

  it("requires match_ids parameter", async () => {
    const res = await compareGET(
      jsonReq("/api/deals/compare", undefined, aliceKey),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("match_ids");
  });

  it("requires at least 2 match_ids", async () => {
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1}`, undefined, aliceKey),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("At least 2");
  });

  it("rejects more than 10 match_ids", async () => {
    const ids = Array(11).fill(matchId1).join(",");
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${ids}`, undefined, aliceKey),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Maximum 10");
  });

  it("only shows deals the agent is part of", async () => {
    // Bob is only in matchId1, not matchId2
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1},${matchId2}`, undefined, bobKey),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("at least 2 valid deals");
  });

  it("returns 404 for all invalid match_ids", async () => {
    const res = await compareGET(
      jsonReq(
        "/api/deals/compare?match_ids=nonexistent1,nonexistent2",
        undefined,
        aliceKey,
      ),
    );
    expect(res.status).toBe(404);
  });

  it("includes overlap scores and message counts", async () => {
    const res = await compareGET(
      jsonReq(`/api/deals/compare?match_ids=${matchId1},${matchId2}`, undefined, aliceKey),
    );
    const data = await res.json();
    for (const comp of data.comparisons) {
      expect(comp.overlap).toBeDefined();
      expect(typeof comp.overlap).toBe("object");
      expect(typeof comp.message_count).toBe("number");
      expect(comp.message_count).toBeGreaterThanOrEqual(1);
    }
  });
});
