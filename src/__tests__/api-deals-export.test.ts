import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { POST as completePOST } from "@/app/api/deals/[matchId]/complete/route";
import { GET as exportGET } from "@/app/api/deals/export/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await createApiKey("alice");
  bobKey = await createApiKey("bob");
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

async function setupDeal() {
  // Alice offers, Bob seeks
  const aliceConnect = await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "alice",
        side: "offering",
        category: "development",
        description: "React developer",
        params: { skills: ["React", "TypeScript"], rate_min: 80, rate_max: 120, currency: "EUR" },
      },
      aliceKey,
    ),
  );
  const { profile_id: aliceProfile } = await aliceConnect.json();

  await connectPOST(
    jsonReq(
      "/api/connect",
      {
        agent_id: "bob",
        side: "seeking",
        category: "development",
        description: "Need a React dev",
        params: { skills: ["React"], rate_min: 70, rate_max: 110, currency: "EUR" },
      },
      bobKey,
    ),
  );

  // Get match
  const matchRes = await matchesGET(jsonReq(`/api/matches/${aliceProfile}`, undefined, aliceKey), {
    params: Promise.resolve({ profileId: aliceProfile }),
  });
  const { matches } = await matchRes.json();
  return matches[0].match_id as string;
}

describe("Deal History Export", () => {
  it("requires authentication", async () => {
    const res = await exportGET(jsonReq("/api/deals/export?agent_id=alice"));
    expect(res.status).toBe(401);
  });

  it("requires agent_id", async () => {
    const res = await exportGET(jsonReq("/api/deals/export", undefined, aliceKey));
    expect(res.status).toBe(400);
  });

  it("rejects exporting other agents deals", async () => {
    const res = await exportGET(jsonReq("/api/deals/export?agent_id=bob", undefined, aliceKey));
    expect(res.status).toBe(403);
  });

  it("rejects invalid format", async () => {
    const res = await exportGET(
      jsonReq("/api/deals/export?agent_id=alice&format=xml", undefined, aliceKey),
    );
    expect(res.status).toBe(400);
  });

  it("returns empty array when no deals", async () => {
    const res = await exportGET(jsonReq("/api/deals/export?agent_id=alice", undefined, aliceKey));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deals).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("exports deals as JSON", async () => {
    const matchId = await setupDeal();

    // Send a message
    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "alice",
          content: "Let's discuss terms",
        },
        aliceKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await exportGET(jsonReq("/api/deals/export?agent_id=alice", undefined, aliceKey));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.deals[0].match_id).toBe(matchId);
    expect(data.deals[0].counterpart_agent_id).toBe("bob");
    expect(data.deals[0].message_count).toBe(1);
    expect(data.deals[0].category).toBeDefined();
    expect(data.deals[0].side).toBeDefined();
    expect(data.deals[0].created_at).toBeDefined();
  });

  it("exports deals as CSV", async () => {
    const matchId = await setupDeal();

    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "alice",
          content: "Hello",
        },
        aliceKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await exportGET(
      jsonReq("/api/deals/export?agent_id=alice&format=csv", undefined, aliceKey),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("alice-deals.csv");

    const text = await res.text();
    const lines = text.split("\n");
    // Header + 1 data row
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("match_id");
    expect(lines[0]).toContain("status");
    expect(lines[0]).toContain("counterpart_agent_id");
    expect(lines[1]).toContain(matchId);
    expect(lines[1]).toContain("bob");
  });

  it("includes proposed terms in export", async () => {
    const matchId = await setupDeal();

    // Send a proposal
    await messagesPOST(
      jsonReq(
        `/api/deals/${matchId}/messages`,
        {
          agent_id: "alice",
          content: "Proposing: 100 EUR/hr",
          message_type: "proposal",
          proposed_terms: { rate: 100, currency: "EUR", hours_per_week: 30 },
        },
        aliceKey,
      ),
      { params: Promise.resolve({ matchId }) },
    );

    const res = await exportGET(jsonReq("/api/deals/export?agent_id=alice", undefined, aliceKey));
    const data = await res.json();
    expect(data.deals[0].proposed_rate).toBe(100);
    expect(data.deals[0].proposed_currency).toBe("EUR");
    expect(data.deals[0].proposed_hours_per_week).toBe(30);
  });

  it("returns empty CSV for agent with no profiles", async () => {
    const res = await exportGET(
      jsonReq("/api/deals/export?agent_id=alice&format=csv", undefined, aliceKey),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("No deals found");
  });

  it("exports multiple deals", async () => {
    // Create first deal
    await setupDeal();

    // Create second deal with a different agent
    const charlieKey = await createApiKey("charlie");
    await connectPOST(
      jsonReq(
        "/api/connect",
        {
          agent_id: "charlie",
          side: "seeking",
          category: "development",
          description: "Need a TypeScript expert",
          params: { skills: ["TypeScript"], rate_min: 90, rate_max: 130, currency: "EUR" },
        },
        charlieKey,
      ),
    );

    // Alice should have 2 matches now
    const res = await exportGET(jsonReq("/api/deals/export?agent_id=alice", undefined, aliceKey));
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.deals.length).toBe(2);
  });
});
