import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findMatches } from "@/lib/matching";
import { createTestDb, _setDb, migrate } from "@/lib/db";
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

async function insertProfile(
  agentId: string,
  side: "offering" | "seeking",
  category: string,
  params: Record<string, unknown>,
  description?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, agentId, side, category, JSON.stringify(params), description ?? null],
  });
  return id;
}

describe("findMatches", () => {
  it("matches offering to seeking in the same category", async () => {
    const offerId = await insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react", "typescript"],
      rate_min: 50,
      rate_max: 70,
    });
    await insertProfile("bob", "seeking", "frontend-dev", {
      skills: ["react"],
      rate_min: 40,
      rate_max: 60,
    });

    const matches = await findMatches(offerId);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.matching_skills).toContain("react");
    expect(matches[0].overlap.rate_overlap).toEqual({ min: 50, max: 60 });
    expect(matches[0].overlap.score).toBeGreaterThan(0);
  });

  it("does not match profiles on the same side", async () => {
    const id1 = await insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react"],
    });
    await insertProfile("bob", "offering", "frontend-dev", {
      skills: ["react"],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("matches across different categories when skills overlap", async () => {
    const id1 = await insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react"],
    });
    await insertProfile("bob", "seeking", "backend-dev", {
      skills: ["react"],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(1);
    // Cross-category match has lower score than same-category
    expect(matches[0].overlap.score).toBeGreaterThan(0);
  });

  it("returns no match when skills don't overlap", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react", "vue"],
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["python", "rust"],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("returns no match when rate ranges don't overlap", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      rate_min: 100,
      rate_max: 150,
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      rate_min: 30,
      rate_max: 50,
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("returns no match when remote preferences are incompatible", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      remote: "remote",
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      remote: "onsite",
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("matches when one side is hybrid", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      remote: "remote",
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      remote: "hybrid",
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.remote_compatible).toBe(true);
  });

  it("matches without rate params (optional)", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.rate_overlap).toBeNull();
  });

  it("creates a match record in the database", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(1);

    const result = await db.execute({
      sql: "SELECT * FROM matches WHERE id = ?",
      args: [matches[0].matchId],
    });
    const matchRow = result.rows[0];
    expect(matchRow).toBeTruthy();
    expect(matchRow.status).toBe("matched");
  });

  it("reuses existing match on subsequent calls", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const first = await findMatches(id1);
    const second = await findMatches(id1);
    expect(first[0].matchId).toBe(second[0].matchId);

    const countResult = await db.execute("SELECT COUNT(*) as c FROM matches");
    expect(Number(countResult.rows[0].c)).toBe(1);
  });

  it("does not match inactive profiles", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    const id2 = await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });
    await db.execute({
      sql: "UPDATE profiles SET active = 0 WHERE id = ?",
      args: [id2],
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("sorts matches by score descending", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react", "typescript", "node"],
      rate_min: 50,
      rate_max: 70,
    });
    // Good match: 2 skills overlap + rate overlap
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react", "typescript"],
      rate_min: 50,
      rate_max: 65,
    });
    // Weaker match: 1 skill overlap + rate overlap
    await insertProfile("charlie", "seeking", "dev", {
      skills: ["react", "python"],
      rate_min: 50,
      rate_max: 65,
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(2);
    expect(matches[0].overlap.score).toBeGreaterThanOrEqual(matches[1].overlap.score);
    expect(matches[0].counterpart.agent_id).toBe("bob");
  });

  it("returns empty for non-existent profile", async () => {
    const matches = await findMatches("nonexistent-id");
    expect(matches).toHaveLength(0);
  });

  it("matches profiles without skills or rate params (category-only)", async () => {
    const id1 = await insertProfile("alice", "offering", "consulting", {});
    await insertProfile("bob", "seeking", "consulting", {});

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.score).toBeGreaterThan(0);
  });

  it("works symmetrically from seeking side", async () => {
    const offerId = await insertProfile("alice", "offering", "dev", { skills: ["react"] });
    const seekId = await insertProfile("bob", "seeking", "dev", { skills: ["react"] });

    const fromOffering = await findMatches(offerId);
    const fromSeeking = await findMatches(seekId);

    expect(fromOffering).toHaveLength(1);
    expect(fromSeeking).toHaveLength(1);
    expect(fromOffering[0].matchId).toBe(fromSeeking[0].matchId);
  });

  it("handles multiple candidates and returns all valid matches", async () => {
    const id1 = await insertProfile("alice", "offering", "dev", {
      skills: ["react", "node"],
      rate_min: 40,
      rate_max: 80,
    });
    await insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      rate_min: 50,
      rate_max: 70,
    });
    await insertProfile("charlie", "seeking", "dev", {
      skills: ["node"],
      rate_min: 40,
      rate_max: 60,
    });
    // Cross-category match - still matches on skill overlap
    await insertProfile("dave", "seeking", "design", {
      skills: ["react"],
      rate_min: 50,
      rate_max: 70,
    });

    const matches = await findMatches(id1);
    expect(matches).toHaveLength(3);
    const agents = matches.map((m) => m.counterpart.agent_id).sort();
    expect(agents).toEqual(["bob", "charlie", "dave"]);
  });
});
