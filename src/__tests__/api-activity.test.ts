import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { GET as activityGET } from "@/app/api/activity/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { NextRequest } from "next/server";
import { _resetRateLimitStore } from "@/lib/rate-limit";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

async function getApiKey(agentId: string): Promise<string> {
  return createApiKey(agentId);
}

beforeEach(async () => {
  _resetRateLimitStore();
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

async function createMatchedPair(): Promise<{
  offeringId: string;
  seekingId: string;
  matchId: string;
}> {
  const r1 = await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "alice",
        side: "offering",
        category: "dev",
        params: { skills: ["react", "ts"], rate_min: 50, rate_max: 70 },
      },
      aliceKey,
    ),
  );
  const { profile_id: offeringId } = await r1.json();

  const r2 = await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "bob",
        side: "seeking",
        category: "dev",
        params: { skills: ["react"], rate_min: 40, rate_max: 60 },
      },
      bobKey,
    ),
  );
  const { profile_id: seekingId } = await r2.json();

  const matchRes = await matchesGET(jsonReq(`/api/matches/${offeringId}`), {
    params: Promise.resolve({ profileId: offeringId }),
  });
  const { matches } = await matchRes.json();
  return { offeringId, seekingId, matchId: matches[0].match_id };
}

describe("GET /api/activity", () => {
  it("requires authentication", async () => {
    const res = await activityGET(jsonReq("/api/activity?agent_id=alice"));
    expect(res.status).toBe(401);
  });

  it("requires agent_id param", async () => {
    const res = await activityGET(jsonReq("/api/activity", undefined, aliceKey));
    expect(res.status).toBe(400);
  });

  it("forbids requesting another agent's activity", async () => {
    const res = await activityGET(jsonReq("/api/activity?agent_id=bob", undefined, aliceKey));
    expect(res.status).toBe(403);
  });

  it("returns empty events for agent with no profiles", async () => {
    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.events).toHaveLength(0);
  });

  it("returns new_match event when a match is created", async () => {
    await createMatchedPair();

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.events.length).toBeGreaterThanOrEqual(1);

    const matchEvent = data.events.find((e: { type: string }) => e.type === "new_match");
    expect(matchEvent).toBeTruthy();
    expect(matchEvent.agent_id).toBe("alice");
    expect(matchEvent.summary).toContain("bob");
    expect(matchEvent.match_id).toBeTruthy();
  });

  it("returns message_received events", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "bob",
          content: "Hey alice, let's talk",
          message_type: "negotiation",
        },
        bobKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();

    const msgEvent = data.events.find((e: { type: string }) => e.type === "message_received");
    expect(msgEvent).toBeTruthy();
    expect(msgEvent.summary).toContain("bob");
  });

  it("returns deal_proposed event for proposals", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "bob",
          content: "Here's my offer",
          message_type: "proposal",
          proposed_terms: { rate: 55 },
        },
        bobKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();

    const proposalEvent = data.events.find((e: { type: string }) => e.type === "deal_proposed");
    expect(proposalEvent).toBeTruthy();
    expect(proposalEvent.summary).toContain("bob");
  });

  it("returns deal_approved event", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "alice",
          content: "Offer",
          message_type: "proposal",
          proposed_terms: { rate: 55 },
        },
        aliceKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();

    const approvalEvent = data.events.find((e: { type: string }) => e.type === "deal_approved");
    expect(approvalEvent).toBeTruthy();
    expect(approvalEvent.summary).toContain("bob");
  });

  it("returns deal_rejected event", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "alice",
          content: "Offer",
          message_type: "proposal",
          proposed_terms: { rate: 55 },
        },
        aliceKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: false }, bobKey),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();

    const rejectEvent = data.events.find((e: { type: string }) => e.type === "deal_rejected");
    expect(rejectEvent).toBeTruthy();
    expect(rejectEvent.summary).toContain("bob");
  });

  it("respects limit parameter", async () => {
    await createMatchedPair();

    const res = await activityGET(
      jsonReq("/api/activity?agent_id=alice&limit=1", undefined, aliceKey),
    );
    const data = await res.json();
    expect(data.events).toHaveLength(1);
  });

  it("caps limit at 100", async () => {
    const res = await activityGET(
      jsonReq("/api/activity?agent_id=alice&limit=200", undefined, aliceKey),
    );
    expect(res.status).toBe(200);
  });

  it("filters events by since parameter", async () => {
    await createMatchedPair();

    const futureDate = "2099-01-01T00:00:00Z";
    const res = await activityGET(
      jsonReq(`/api/activity?agent_id=alice&since=${futureDate}`, undefined, aliceKey),
    );
    const data = await res.json();
    expect(data.events).toHaveLength(0);
  });

  it("events are ordered by timestamp descending", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "bob",
          content: "Hello",
          message_type: "negotiation",
        },
        bobKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await activityGET(jsonReq("/api/activity?agent_id=alice", undefined, aliceKey));
    const data = await res.json();

    expect(data.events.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < data.events.length; i++) {
      const prev = new Date(data.events[i - 1].timestamp).getTime();
      const curr = new Date(data.events[i].timestamp).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});
