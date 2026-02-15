import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { GET as dealsGET } from "@/app/api/deals/route";
import { GET as dealDetailGET } from "@/app/api/deals/[matchId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { POST as startPOST } from "@/app/api/deals/[matchId]/start/route";
import { POST as completePOST } from "@/app/api/deals/[matchId]/complete/route";
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

async function createMatchedPair(): Promise<{ offeringId: string; seekingId: string; matchId: string }> {
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
  return { offeringId, seekingId, matchId: matches[0].match_id };
}

describe("GET /api/matches/:profileId", () => {
  it("returns matches for a profile", async () => {
    const { matchId } = await createMatchedPair();
    expect(matchId).toBeTruthy();
  });

  it("returns 404 for inactive profile", async () => {
    const xKey = await getApiKey("x");
    const r = await connectPOST(jsonReq("/api/connect", {
      agent_id: "x", side: "offering", category: "dev", params: {},
    }, xKey));
    const { profile_id } = await r.json();
    await db.execute({
      sql: "UPDATE profiles SET active = 0 WHERE id = ?",
      args: [profile_id],
    });

    const res = await matchesGET(
      jsonReq(`/api/matches/${profile_id}`),
      { params: Promise.resolve({ profileId: profile_id }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/deals", () => {
  it("lists deals for an agent", async () => {
    await createMatchedPair();
    const res = await dealsGET(jsonReq("/api/deals?agent_id=alice"));
    const data = await res.json();
    expect(data.deals).toHaveLength(1);
    expect(data.deals[0].counterpart_agent_id).toBe("bob");
  });

  it("returns empty for unknown agent", async () => {
    const res = await dealsGET(jsonReq("/api/deals?agent_id=nobody"));
    const data = await res.json();
    expect(data.deals).toHaveLength(0);
  });

  it("requires agent_id", async () => {
    const res = await dealsGET(jsonReq("/api/deals"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/deals/:matchId", () => {
  it("returns deal detail with profiles", async () => {
    const { matchId } = await createMatchedPair();
    const res = await dealDetailGET(
      jsonReq(`/api/deals/${matchId}`),
      { params: Promise.resolve({ matchId }) }
    );
    const data = await res.json();
    expect(data.match.status).toBe("matched");
    expect(data.messages).toHaveLength(0);
    expect(data.approvals).toHaveLength(0);
  });

  it("returns 404 for non-existent deal", async () => {
    const res = await dealDetailGET(
      jsonReq("/api/deals/nonexistent"),
      { params: Promise.resolve({ matchId: "nonexistent" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/deals/:matchId/messages", () => {
  it("sends a negotiation message and updates status", async () => {
    const { matchId } = await createMatchedPair();

    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice",
        content: "Hi, let's discuss terms.",
        message_type: "negotiation",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("negotiating");
  });

  it("sends a proposal and moves to proposed status", async () => {
    const { matchId } = await createMatchedPair();

    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "bob",
        content: "Here's my offer",
        message_type: "proposal",
        proposed_terms: { rate: 55, hours: 25 },
      }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    const data = await res.json();
    expect(data.status).toBe("proposed");
  });

  it("rejects message from non-participant", async () => {
    const { matchId } = await createMatchedPair();
    const charlieKey = await getApiKey("charlie");

    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "charlie",
        content: "I'm an intruder",
      }, charlieKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(403);
  });

  it("rejects proposal without proposed_terms", async () => {
    const { matchId } = await createMatchedPair();

    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice",
        content: "Proposal",
        message_type: "proposal",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/deals/:matchId/approve", () => {
  it("handles full approval flow", async () => {
    const { matchId } = await createMatchedPair();

    // Move to proposed first (required for approval)
    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Offer", message_type: "proposal",
        proposed_terms: { rate: 55 },
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    // Alice approves
    const r1 = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    const d1 = await r1.json();
    expect(d1.status).toBe("waiting");

    // Bob approves
    const r2 = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    const d2 = await r2.json();
    expect(d2.status).toBe("approved");
  });

  it("handles rejection", async () => {
    const { matchId } = await createMatchedPair();

    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Offer", message_type: "proposal",
        proposed_terms: { rate: 55 },
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    const res = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: false }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    const data = await res.json();
    expect(data.status).toBe("rejected");
  });

  it("rejects approval on non-proposed deal", async () => {
    const { matchId } = await createMatchedPair();

    const res = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(400);
  });

  it("rejects approval from non-participant", async () => {
    const { matchId } = await createMatchedPair();
    const charlieKey = await getApiKey("charlie");

    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Offer", message_type: "proposal",
        proposed_terms: { rate: 55 },
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    const res = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "charlie", approved: true }, charlieKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(403);
  });

  it("accepts 'text' as message_type alias for negotiation", async () => {
    const { matchId } = await createMatchedPair();
    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Hello, interested in working together!", message_type: "text",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message_id).toBeDefined();
    expect(data.status).toBe("negotiating");
  });

  it("allows messaging after deal is approved (post-deal coordination)", async () => {
    const { matchId } = await createMatchedPair();
    // Propose
    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Offer", message_type: "proposal",
        proposed_terms: { rate: 50 },
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
    // Should be able to message after approval
    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Great, let's coordinate delivery details", message_type: "negotiation",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message_id).toBeDefined();
  });

  it("blocks messaging on rejected deals", async () => {
    const { matchId } = await createMatchedPair();
    await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Offer", message_type: "proposal",
        proposed_terms: { rate: 50 },
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: false }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Can we reconsider?", message_type: "negotiation",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(400);
  });
});

/** Helper: bring a deal to 'approved' status */
async function createApprovedDeal(): Promise<{ matchId: string }> {
  const { matchId } = await createMatchedPair();
  await messagesPOST(
    jsonReq(`/api/deals/${matchId}/messages`, {
      agent_id: "alice", content: "Offer", message_type: "proposal",
      proposed_terms: { rate: 55 },
    }, aliceKey),
    { params: Promise.resolve({ matchId }) }
  );
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
    { params: Promise.resolve({ matchId }) }
  );
  await approvePOST(
    jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
    { params: Promise.resolve({ matchId }) }
  );
  return { matchId };
}

describe("POST /api/deals/:matchId/start", () => {
  it("starts a deal from approved status", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("in_progress");
  });

  it("cannot start a non-approved deal", async () => {
    const { matchId } = await createMatchedPair();

    const res = await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("approved");
  });

  it("rejects start from non-participant", async () => {
    const { matchId } = await createApprovedDeal();
    const charlieKey = await getApiKey("charlie");

    const res = await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "charlie" }, charlieKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(403);
  });

  it("creates a system message when deal is started", async () => {
    const { matchId } = await createApprovedDeal();

    await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "bob" }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );

    const msgs = await db.execute({
      sql: "SELECT * FROM messages WHERE match_id = ? AND message_type = 'system' AND content LIKE '%started%'",
      args: [matchId],
    });
    expect(msgs.rows.length).toBe(1);
    expect((msgs.rows[0] as any).content).toContain("Deal started by bob");
  });
});

describe("POST /api/deals/:matchId/complete", () => {
  it("requires both parties to confirm completion", async () => {
    const { matchId } = await createApprovedDeal();

    await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    const r1 = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    const d1 = await r1.json();
    expect(d1.status).toBe("waiting");

    const r2 = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "bob" }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    const d2 = await r2.json();
    expect(d2.status).toBe("completed");
  });

  it("cannot complete a non-in_progress deal", async () => {
    const { matchId } = await createApprovedDeal();

    const res = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("in_progress");
  });

  it("rejects completion from non-participant", async () => {
    const { matchId } = await createApprovedDeal();
    const charlieKey = await getApiKey("charlie");

    await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    const res = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "charlie" }, charlieKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(403);
  });

  it("full lifecycle: matched -> negotiating -> proposed -> approved -> in_progress -> completed", async () => {
    const { matchId } = await createMatchedPair();

    // matched -> negotiating
    const msgRes = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "alice", content: "Let's discuss", message_type: "negotiation",
      }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await msgRes.json()).status).toBe("negotiating");

    // negotiating -> proposed
    const propRes = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "bob", content: "My offer", message_type: "proposal",
        proposed_terms: { rate: 55, hours: 20 },
      }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await propRes.json()).status).toBe("proposed");

    // proposed -> approved
    const a1 = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "alice", approved: true }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await a1.json()).status).toBe("waiting");

    const a2 = await approvePOST(
      jsonReq(`/api/deals/${matchId}/approve`, { agent_id: "bob", approved: true }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await a2.json()).status).toBe("approved");

    // approved -> in_progress
    const startRes = await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await startRes.json()).status).toBe("in_progress");

    // in_progress -> completed
    const c1 = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await c1.json()).status).toBe("waiting");

    const c2 = await completePOST(
      jsonReq(`/api/deals/${matchId}/complete`, { agent_id: "bob" }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect((await c2.json()).status).toBe("completed");

    // Verify final status
    const finalMatch = await db.execute({
      sql: "SELECT status FROM matches WHERE id = ?",
      args: [matchId],
    });
    expect((finalMatch.rows[0] as any).status).toBe("completed");
  });

  it("allows messaging on in_progress deals", async () => {
    const { matchId } = await createApprovedDeal();

    await startPOST(
      jsonReq(`/api/deals/${matchId}/start`, { agent_id: "alice" }, aliceKey),
      { params: Promise.resolve({ matchId }) }
    );

    const res = await messagesPOST(
      jsonReq(`/api/deals/${matchId}/messages`, {
        agent_id: "bob", content: "Progress update: halfway done", message_type: "negotiation",
      }, bobKey),
      { params: Promise.resolve({ matchId }) }
    );
    expect(res.status).toBe(200);
  });
});
