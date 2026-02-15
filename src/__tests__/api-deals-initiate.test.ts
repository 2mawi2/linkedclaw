import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST as connectPOST } from "@/app/api/connect/route";
import { POST as dealsPOST, GET as dealsGET } from "@/app/api/deals/route";
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

async function createProfile(
  agentId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ apiKey: string; profileId: string }> {
  const apiKey = await createApiKey(agentId);
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
  const data = await res.json();
  return { apiKey, profileId: data.profile_id };
}

function dealRequest(apiKey: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/deals", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
}

describe("POST /api/deals - Initiate deal", () => {
  it("creates a deal between two profiles with no skill overlap", async () => {
    // Use non-overlapping skills so auto-matching doesn't create a match
    const a = await createProfile("bot-a", {
      side: "offering",
      params: { skills: ["golang"], rate_min: 80, rate_max: 120 },
    });
    const b = await createProfile("bot-b", {
      side: "seeking",
      params: { skills: ["python"], rate_min: 90, rate_max: 130 },
    });

    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.match_id).toBeDefined();
    expect(data.status).toBe("negotiating");
    expect(data.target_agent_id).toBe("bot-b");
  });

  it("returns existing deal when auto-matching already created it", async () => {
    // Overlapping skills - auto-matching creates the deal at connect time
    const a = await createProfile("am-bot-a", { side: "offering" });
    const b = await createProfile("am-bot-b", { side: "seeking" });

    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.match_id).toBeDefined();
    expect(data.existing).toBe(true);
  });

  it("includes opening message when provided", async () => {
    const a = await createProfile("msg-bot-a", {
      side: "offering",
      params: { skills: ["rust"], rate_min: 80, rate_max: 120 },
    });
    const b = await createProfile("msg-bot-b", {
      side: "seeking",
      params: { skills: ["elixir"], rate_min: 90, rate_max: 130 },
    });

    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
        message: "Hi, I'm interested in working together!",
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();

    // Verify message was stored
    const msgResult = await db.execute({
      sql: "SELECT content FROM messages WHERE match_id = ?",
      args: [data.match_id],
    });
    expect(msgResult.rows).toHaveLength(1);
    expect(msgResult.rows[0].content).toBe("Hi, I'm interested in working together!");
  });

  it("returns existing deal if one already exists", async () => {
    const a = await createProfile("exist-bot-a", {
      side: "offering",
      params: { skills: ["haskell"], rate_min: 80, rate_max: 120 },
    });
    const b = await createProfile("exist-bot-b", {
      side: "seeking",
      params: { skills: ["clojure"], rate_min: 90, rate_max: 130 },
    });

    const res1 = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    expect(res1.status).toBe(201);

    const res2 = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    expect(res2.status).toBe(200);
    const data = await res2.json();
    expect(data.existing).toBe(true);
  });

  it("rejects unauthenticated requests", async () => {
    const req = new NextRequest("http://localhost:3000/api/deals", {
      method: "POST",
      body: JSON.stringify({ profile_id: "a", target_profile_id: "b" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await dealsPOST(req);
    expect(res.status).toBe(401);
  });

  it("rejects if caller doesn't own profile_id", async () => {
    const a = await createProfile("own-bot-a", { side: "offering" });
    const b = await createProfile("own-bot-b", { side: "seeking" });

    // bot-b tries to use bot-a's profile
    const res = await dealsPOST(
      dealRequest(b.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects deal with yourself", async () => {
    const a = await createProfile("self-bot");

    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: a.profileId,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects if target profile doesn't exist", async () => {
    const a = await createProfile("ghost-bot-a");

    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: "nonexistent-id",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects missing required fields", async () => {
    const a = await createProfile("field-bot");

    const res = await dealsPOST(dealRequest(a.apiKey, { profile_id: a.profileId }));
    expect(res.status).toBe(400);
  });

  it("initiated deal shows up in GET /api/deals", async () => {
    const a = await createProfile("list-bot-a", {
      side: "offering",
      params: { skills: ["swift"], rate_min: 80, rate_max: 120 },
    });
    const b = await createProfile("list-bot-b", {
      side: "seeking",
      params: { skills: ["kotlin"], rate_min: 90, rate_max: 130 },
    });

    await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );

    // Both agents should see the deal
    const resA = await dealsGET(
      new NextRequest("http://localhost:3000/api/deals?agent_id=list-bot-a"),
    );
    const dataA = await resA.json();
    expect(dataA.deals).toHaveLength(1);
    expect(dataA.deals[0].counterpart_agent_id).toBe("list-bot-b");

    const resB = await dealsGET(
      new NextRequest("http://localhost:3000/api/deals?agent_id=list-bot-b"),
    );
    const dataB = await resB.json();
    expect(dataB.deals).toHaveLength(1);
    expect(dataB.deals[0].counterpart_agent_id).toBe("list-bot-a");
  });

  it("calculates overlap with shared skills", async () => {
    // Use some shared and some unique skills, but avoid auto-match by using same side
    // Actually, use opposite sides with unique enough skills for a manual deal test
    const a = await createProfile("skill-a", {
      side: "offering",
      params: { skills: ["react", "node", "typescript"], rate_min: 80, rate_max: 120 },
      category: "niche-a",
    });
    const b = await createProfile("skill-b", {
      side: "seeking",
      params: { skills: ["react", "typescript", "python"], rate_min: 60, rate_max: 100 },
      category: "niche-b",
    });

    // Auto-matching should have found this (cross-category matching is enabled)
    // so POST /api/deals may return existing. Either way, verify the deal exists.
    const res = await dealsPOST(
      dealRequest(a.apiKey, {
        profile_id: a.profileId,
        target_profile_id: b.profileId,
      }),
    );
    const data = await res.json();
    expect(data.match_id).toBeDefined();

    // Verify match exists in DB with correct overlap
    const matchResult = await db.execute({
      sql: "SELECT overlap_summary FROM matches WHERE id = ?",
      args: [data.match_id],
    });
    expect(matchResult.rows.length).toBe(1);
    const overlap = JSON.parse(matchResult.rows[0].overlap_summary as string);
    expect(overlap.matching_skills || overlap.shared_skills).toBeDefined();
    const skills = overlap.matching_skills || overlap.shared_skills;
    expect(skills).toContain("react");
    expect(skills).toContain("typescript");
  });
});
