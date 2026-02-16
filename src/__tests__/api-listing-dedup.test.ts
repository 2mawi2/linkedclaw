import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { GET, POST } from "@/app/api/listings/duplicates/route";
import { computeDedupScore, DEDUP_THRESHOLD } from "@/lib/listing-dedup";
import type { DedupCandidate } from "@/lib/listing-dedup";
import { createApiKey } from "@/__tests__/test-helpers";
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

async function seedAgent(agentId: string): Promise<string> {
  return createApiKey(agentId);
}

async function seedListing(
  id: string,
  agentId: string,
  side: string,
  category: string,
  description: string | null,
  params: Record<string, unknown>,
) {
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))",
    args: [id, agentId, side, category, JSON.stringify(params), description],
  });
}

function authReq(method: string, url: string, key: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (body) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Listing Deduplication", () => {
  describe("computeDedupScore", () => {
    it("returns 0 for different sides", () => {
      const a: DedupCandidate = {
        profile_id: "a",
        side: "offering",
        category: "freelance-dev",
        description: "React developer",
        params: { skills: ["react", "typescript"] },
        created_at: "2026-01-01",
      };
      const b: DedupCandidate = {
        profile_id: "b",
        side: "seeking",
        category: "freelance-dev",
        description: "React developer",
        params: { skills: ["react", "typescript"] },
        created_at: "2026-01-01",
      };
      const result = computeDedupScore(a, b);
      expect(result.score).toBe(0);
    });

    it("scores high for near-identical listings", () => {
      const a: DedupCandidate = {
        profile_id: "a",
        side: "offering",
        category: "freelance-dev",
        description: "Experienced React and TypeScript developer available for projects",
        params: { skills: ["react", "typescript", "node"] },
        created_at: "2026-01-01",
      };
      const b: DedupCandidate = {
        profile_id: "b",
        side: "offering",
        category: "freelance-dev",
        description: "Experienced React and TypeScript developer available for projects",
        params: { skills: ["react", "typescript", "node"] },
        created_at: "2026-01-02",
      };
      const result = computeDedupScore(a, b);
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.reasons).toContain("same_category");
      expect(result.reasons).toContain("similar_description");
      expect(result.reasons).toContain("overlapping_skills");
    });

    it("scores low for same category but different content", () => {
      const a: DedupCandidate = {
        profile_id: "a",
        side: "offering",
        category: "freelance-dev",
        description: "Machine learning engineer specializing in computer vision",
        params: { skills: ["python", "tensorflow", "opencv"] },
        created_at: "2026-01-01",
      };
      const b: DedupCandidate = {
        profile_id: "b",
        side: "offering",
        category: "freelance-dev",
        description: "Frontend web developer with focus on accessibility",
        params: { skills: ["html", "css", "aria"] },
        created_at: "2026-01-02",
      };
      const result = computeDedupScore(a, b);
      expect(result.score).toBeLessThan(DEDUP_THRESHOLD);
    });

    it("detects duplicates with slightly different wording", () => {
      const a: DedupCandidate = {
        profile_id: "a",
        side: "offering",
        category: "freelance-dev",
        description: "Full stack developer React Node TypeScript available immediately",
        params: { skills: ["react", "node", "typescript"] },
        created_at: "2026-01-01",
      };
      const b: DedupCandidate = {
        profile_id: "b",
        side: "offering",
        category: "freelance-dev",
        description: "Available immediately full stack developer TypeScript React Node",
        params: { skills: ["typescript", "react", "node"] },
        created_at: "2026-01-02",
      };
      const result = computeDedupScore(a, b);
      expect(result.score).toBeGreaterThanOrEqual(DEDUP_THRESHOLD);
    });
  });

  describe("GET /api/listings/duplicates", () => {
    it("requires authentication", async () => {
      const req = new NextRequest("http://localhost:3000/api/listings/duplicates");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it("returns empty when no duplicates", async () => {
      const key = await seedAgent("alice");
      await seedListing("p1", "alice", "offering", "freelance-dev", "React dev", {
        skills: ["react"],
      });
      await seedListing("p2", "alice", "offering", "design", "UI designer", {
        skills: ["figma"],
      });

      const res = await GET(authReq("GET", "/api/listings/duplicates", key));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.duplicates_found).toBe(0);
      expect(data.total_active_listings).toBe(2);
    });

    it("detects near-duplicate listings", async () => {
      const key = await seedAgent("alice");
      await seedListing(
        "p1",
        "alice",
        "offering",
        "freelance-dev",
        "React TypeScript developer available for contract work",
        {
          skills: ["react", "typescript"],
        },
      );
      await seedListing(
        "p2",
        "alice",
        "offering",
        "freelance-dev",
        "React TypeScript developer available for contract work now",
        {
          skills: ["react", "typescript"],
        },
      );

      const res = await GET(authReq("GET", "/api/listings/duplicates", key));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.duplicates_found).toBeGreaterThan(0);
      expect(data.duplicates[0].score).toBeGreaterThanOrEqual(60);
    });

    it("supports custom threshold", async () => {
      const key = await seedAgent("alice");
      await seedListing("p1", "alice", "offering", "freelance-dev", "React dev", {
        skills: ["react"],
      });
      await seedListing("p2", "alice", "offering", "freelance-dev", "TypeScript dev", {
        skills: ["typescript"],
      });

      // Low threshold should catch more
      const res = await GET(authReq("GET", "/api/listings/duplicates?threshold=20", key));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.threshold).toBe(20);
    });

    it("rejects invalid threshold", async () => {
      const key = await seedAgent("alice");
      const res = await GET(authReq("GET", "/api/listings/duplicates?threshold=0", key));
      expect(res.status).toBe(400);
    });

    it("filters by profile_id", async () => {
      const key = await seedAgent("alice");
      await seedListing("p1", "alice", "offering", "freelance-dev", "React dev", {
        skills: ["react"],
      });
      await seedListing("p2", "alice", "offering", "design", "Designer", {
        skills: ["figma"],
      });

      const res = await GET(authReq("GET", "/api/listings/duplicates?profile_id=p1", key));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.duplicates).toBeDefined();
    });

    it("returns 404 for non-existent profile_id", async () => {
      const key = await seedAgent("alice");
      const res = await GET(authReq("GET", "/api/listings/duplicates?profile_id=nonexistent", key));
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/listings/duplicates (preview)", () => {
    it("requires authentication", async () => {
      const req = new NextRequest("http://localhost:3000/api/listings/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ side: "offering", category: "freelance-dev" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("detects duplicate before creating", async () => {
      const key = await seedAgent("alice");
      await seedListing(
        "p1",
        "alice",
        "offering",
        "freelance-dev",
        "React TypeScript developer for contract work",
        {
          skills: ["react", "typescript"],
        },
      );

      const res = await POST(
        authReq("POST", "/api/listings/duplicates", key, {
          side: "offering",
          category: "freelance-dev",
          description: "React TypeScript developer for contract work",
          params: { skills: ["react", "typescript"] },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.is_duplicate).toBe(true);
      expect(data.duplicates_found).toBeGreaterThan(0);
    });

    it("returns clean when no duplicates", async () => {
      const key = await seedAgent("alice");
      await seedListing("p1", "alice", "offering", "freelance-dev", "React dev", {
        skills: ["react"],
      });

      const res = await POST(
        authReq("POST", "/api/listings/duplicates", key, {
          side: "seeking",
          category: "design",
          description: "Need a logo designer",
          params: { skills: ["logo", "branding"] },
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.is_duplicate).toBe(false);
      expect(data.duplicates_found).toBe(0);
    });

    it("validates required fields", async () => {
      const key = await seedAgent("alice");
      const res = await POST(authReq("POST", "/api/listings/duplicates", key, { side: "invalid" }));
      expect(res.status).toBe(400);
    });

    it("validates category required", async () => {
      const key = await seedAgent("alice");
      const res = await POST(
        authReq("POST", "/api/listings/duplicates", key, { side: "offering" }),
      );
      expect(res.status).toBe(400);
    });
  });
});
