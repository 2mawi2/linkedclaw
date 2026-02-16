import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/recommendations/route";
import { getAgentRecommendations } from "@/lib/agent-recommendations";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await createApiKey("alice");
});

afterEach(() => {
  restore();
});

function authReq(url: string, apiKey: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function req(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" });
}

async function insertProfile(
  agentId: string,
  category: string,
  side: string = "offering",
): Promise<string> {
  const id = `p-${Math.random().toString(36).slice(2, 10)}`;
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params, active)
          VALUES (?, ?, ?, ?, '{"skills":["typescript"]}', 1)`,
    args: [id, agentId, side, category],
  });
  return id;
}

async function insertMatch(profileAId: string, profileBId: string): Promise<string> {
  const id = `m-${Math.random().toString(36).slice(2, 10)}`;
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary)
          VALUES (?, ?, ?, '{}')`,
    args: [id, profileAId, profileBId],
  });
  return id;
}

describe("Agent Recommendations", () => {
  describe("API", () => {
    it("returns 401 without auth", async () => {
      const res = await GET(req("/api/recommendations"));
      expect(res.status).toBe(401);
    });

    it("returns empty recommendations for agent with no listings", async () => {
      const res = await GET(authReq("/api/recommendations", aliceKey));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recommendations).toEqual([]);
      expect(body.agent_id).toBe("alice");
      expect(body.generated_at).toBeDefined();
    });

    it("recommends agents in same category", async () => {
      await insertProfile("alice", "freelance-dev");
      await insertProfile("bob", "freelance-dev");

      const res = await GET(authReq("/api/recommendations", aliceKey));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recommendations).toHaveLength(1);
      expect(body.recommendations[0].agent_id).toBe("bob");
      expect(body.recommendations[0].shared_categories).toEqual(["freelance-dev"]);
    });

    it("does not recommend agents with no category overlap", async () => {
      await insertProfile("alice", "freelance-dev");
      await insertProfile("bob", "content-writing");

      const res = await GET(authReq("/api/recommendations", aliceKey));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recommendations).toHaveLength(0);
    });

    it("validates limit parameter", async () => {
      const res = await GET(authReq("/api/recommendations?limit=0", aliceKey));
      expect(res.status).toBe(400);

      const res2 = await GET(authReq("/api/recommendations?limit=100", aliceKey));
      expect(res2.status).toBe(400);
    });

    it("respects limit parameter", async () => {
      await insertProfile("alice", "freelance-dev");
      await insertProfile("bob", "freelance-dev");
      await insertProfile("charlie", "freelance-dev");
      await insertProfile("dave", "freelance-dev");

      const res = await GET(authReq("/api/recommendations?limit=2", aliceKey));
      const body = await res.json();
      expect(body.recommendations).toHaveLength(2);
    });
  });

  describe("getAgentRecommendations", () => {
    it("scores shared deal partners higher than categories alone", async () => {
      // Alice and Bob share a category
      const aliceProfile = await insertProfile("alice", "freelance-dev");
      const bobProfile = await insertProfile("bob", "freelance-dev");
      await insertProfile("charlie", "freelance-dev");

      // Create a common partner (dave) that both alice and bob dealt with
      const daveOffering = await insertProfile("dave", "freelance-dev", "seeking");
      await insertMatch(aliceProfile, daveOffering);
      await insertMatch(bobProfile, daveOffering);

      const results = await getAgentRecommendations(db, "alice", { limit: 10 });
      // Bob should rank higher because shared partner + shared category
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].agent_id).toBe("bob");
      expect(results[0].shared_deal_partners).toBe(1);
    });

    it("ranks by relevance score", async () => {
      await insertProfile("alice", "freelance-dev");
      await insertProfile("alice", "devops");

      // Bob matches 2 categories
      await insertProfile("bob", "freelance-dev");
      await insertProfile("bob", "devops");

      // Charlie matches 1 category
      await insertProfile("charlie", "freelance-dev");

      const results = await getAgentRecommendations(db, "alice", { limit: 10 });
      expect(results[0].agent_id).toBe("bob");
      expect(results[0].shared_categories).toContain("freelance-dev");
      expect(results[0].shared_categories).toContain("devops");
    });

    it("excludes self from recommendations", async () => {
      await insertProfile("alice", "freelance-dev");
      const results = await getAgentRecommendations(db, "alice", { limit: 10 });
      expect(results.find((r) => r.agent_id === "alice")).toBeUndefined();
    });

    it("only considers active listings", async () => {
      await insertProfile("alice", "freelance-dev");
      // Insert inactive profile for bob
      const id = `p-${Math.random().toString(36).slice(2, 10)}`;
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params, active)
              VALUES (?, 'bob', 'offering', 'freelance-dev', '{}', 0)`,
        args: [id],
      });

      const results = await getAgentRecommendations(db, "alice", { limit: 10 });
      expect(results).toHaveLength(0);
    });

    it("returns multiple shared categories", async () => {
      await insertProfile("alice", "freelance-dev");
      await insertProfile("alice", "ai-ml");
      await insertProfile("bob", "freelance-dev");
      await insertProfile("bob", "ai-ml");
      await insertProfile("bob", "content-writing");

      const results = await getAgentRecommendations(db, "alice", { limit: 10 });
      expect(results[0].shared_categories).toHaveLength(2);
      expect(results[0].shared_categories).toContain("freelance-dev");
      expect(results[0].shared_categories).toContain("ai-ml");
    });
  });
});
