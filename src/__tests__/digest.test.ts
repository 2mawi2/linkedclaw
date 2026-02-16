import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { generateDigest } from "@/lib/digest";
import { GET as digestGET } from "@/app/api/digest/route";
import { GET as prefsGET, POST as prefsPOST } from "@/app/api/digest/preferences/route";
import { POST as registerPOST } from "@/app/api/register/route";
import { POST as connectPOST } from "@/app/api/connect/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";

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

function jsonReq(url: string, body?: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function registerAgent(username: string): Promise<string> {
  const res = await registerPOST(jsonReq("/api/register", { username, password: "testpass123" }));
  const data = await res.json();
  return data.api_key;
}

describe("Digest", () => {
  describe("generateDigest lib", () => {
    it("returns empty digest for new agent", async () => {
      await registerAgent("agent-fresh");
      const digest = await generateDigest(db, "agent-fresh", "2020-01-01 00:00:00");
      expect(digest.agent_id).toBe("agent-fresh");
      expect(digest.new_listings).toEqual([]);
      expect(digest.new_bounties).toEqual([]);
      expect(digest.deal_updates).toEqual([]);
      expect(digest.summary).toBe("No new activity matching your profile.");
    });

    it("returns matching listings from other agents", async () => {
      // Agent A: offering React
      const keyA = await registerAgent("agent-a");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "agent-a",
            side: "offering",
            category: "development",
            description: "React dev",
            params: { skills: ["React", "TypeScript"], rate_min: 80, rate_max: 120 },
          },
          keyA,
        ),
      );

      // Agent B: seeking React dev
      const keyB = await registerAgent("agent-b");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "agent-b",
            side: "seeking",
            category: "development",
            description: "Need React dev",
            params: { skills: ["React", "Tailwind"], rate_min: 70, rate_max: 110 },
          },
          keyB,
        ),
      );

      // Agent A's digest should show agent B's listing
      const digest = await generateDigest(db, "agent-a", "2020-01-01 00:00:00");
      expect(digest.new_listings.length).toBeGreaterThanOrEqual(1);
      const bListing = digest.new_listings.find((l) => l.agent_id === "agent-b");
      expect(bListing).toBeDefined();
      expect(bListing!.category).toBe("development");
    });

    it("excludes own listings", async () => {
      const keyA = await registerAgent("agent-self");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "agent-self",
            side: "offering",
            category: "development",
            description: "React dev",
            params: { skills: ["React"], rate_min: 80, rate_max: 120 },
          },
          keyA,
        ),
      );

      const digest = await generateDigest(db, "agent-self", "2020-01-01 00:00:00");
      const ownListings = digest.new_listings.filter((l) => l.agent_id === "agent-self");
      expect(ownListings.length).toBe(0);
    });

    it("filters by matching skills/category", async () => {
      // Agent A: development/React
      const keyA = await registerAgent("dev-agent");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "dev-agent",
            side: "offering",
            category: "development",
            description: "React dev",
            params: { skills: ["React"], rate_min: 80, rate_max: 120 },
          },
          keyA,
        ),
      );

      // Agent B: design (different category, no skill overlap)
      const keyB = await registerAgent("design-agent");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "design-agent",
            side: "offering",
            category: "design",
            description: "UI designer",
            params: { skills: ["Figma", "Photoshop"], rate_min: 60, rate_max: 100 },
          },
          keyB,
        ),
      );

      // Agent C: development/Python (same category, different skills)
      const keyC = await registerAgent("python-agent");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "python-agent",
            side: "offering",
            category: "development",
            description: "Python dev",
            params: { skills: ["Python", "Django"], rate_min: 70, rate_max: 100 },
          },
          keyC,
        ),
      );

      const digest = await generateDigest(db, "dev-agent", "2020-01-01 00:00:00");
      // Should include python-agent (same category) but not design-agent
      const agentIds = digest.new_listings.map((l) => l.agent_id);
      expect(agentIds).toContain("python-agent");
      expect(agentIds).not.toContain("design-agent");
    });

    it("includes bounties matching category", async () => {
      const keyA = await registerAgent("bounty-checker");
      await connectPOST(
        jsonReq(
          "/api/connect",
          {
            agent_id: "bounty-checker",
            side: "offering",
            category: "development",
            description: "Developer",
            params: { skills: ["React"], rate_min: 80, rate_max: 120 },
          },
          keyA,
        ),
      );

      // Insert a bounty directly
      await db.execute({
        sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, skills, budget_min, budget_max, currency, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "bounty-1",
          "someone-else",
          "Build a React dashboard",
          "Need a dashboard built",
          "development",
          '["React","TypeScript"]',
          500,
          2000,
          "USD",
          "open",
        ],
      });

      const digest = await generateDigest(db, "bounty-checker", "2020-01-01 00:00:00");
      expect(digest.new_bounties.length).toBe(1);
      expect(digest.new_bounties[0].title).toBe("Build a React dashboard");
    });
  });

  describe("GET /api/digest", () => {
    it("requires auth", async () => {
      const res = await digestGET(jsonReq("/api/digest"));
      expect(res.status).toBe(401);
    });

    it("returns digest with default window", async () => {
      const key = await registerAgent("digest-user");
      const res = await digestGET(jsonReq("/api/digest", undefined, key));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agent_id).toBe("digest-user");
      expect(body.since).toBeDefined();
      expect(body.until).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(body.new_listings).toEqual([]);
    });

    it("accepts since parameter", async () => {
      const key = await registerAgent("digest-since");
      const res = await digestGET(
        jsonReq("/api/digest?since=2025-01-01T00:00:00Z", undefined, key),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.since).toContain("2025-01-01");
    });

    it("rejects invalid since", async () => {
      const key = await registerAgent("digest-bad-since");
      const res = await digestGET(jsonReq("/api/digest?since=not-a-date", undefined, key));
      expect(res.status).toBe(400);
    });
  });

  describe("Digest preferences", () => {
    it("returns no preferences initially", async () => {
      const key = await registerAgent("pref-new");
      const res = await prefsGET(jsonReq("/api/digest/preferences", undefined, key));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.interval).toBeNull();
    });

    it("sets and reads preferences", async () => {
      const key = await registerAgent("pref-set");

      // Set
      const setRes = await prefsPOST(jsonReq("/api/digest/preferences", { interval: "6h" }, key));
      expect(setRes.status).toBe(200);
      const setBody = await setRes.json();
      expect(setBody.interval).toBe("6h");
      expect(setBody.enabled).toBe(true);

      // Read back
      const getRes = await prefsGET(jsonReq("/api/digest/preferences", undefined, key));
      const getBody = await getRes.json();
      expect(getBody.interval).toBe("6h");
      expect(getBody.enabled).toBe(true);
    });

    it("upserts preferences", async () => {
      const key = await registerAgent("pref-upsert");

      await prefsPOST(jsonReq("/api/digest/preferences", { interval: "1h" }, key));
      const res = await prefsPOST(
        jsonReq("/api/digest/preferences", { interval: "24h", enabled: false }, key),
      );
      const body = await res.json();
      expect(body.interval).toBe("24h");
      expect(body.enabled).toBe(false);
    });

    it("rejects invalid interval", async () => {
      const key = await registerAgent("pref-invalid");
      const res = await prefsPOST(jsonReq("/api/digest/preferences", { interval: "30m" }, key));
      expect(res.status).toBe(400);
    });

    it("requires auth for GET", async () => {
      const res = await prefsGET(jsonReq("/api/digest/preferences"));
      expect(res.status).toBe(401);
    });

    it("requires auth for POST", async () => {
      const res = await prefsPOST(jsonReq("/api/digest/preferences", { interval: "1h" }));
      expect(res.status).toBe(401);
    });
  });
});
