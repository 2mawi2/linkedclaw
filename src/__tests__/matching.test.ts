import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findMatches } from "@/lib/matching";
import { createTestDb, _setDb } from "@/lib/db";
import type Database from "better-sqlite3";

let db: Database.Database;
let restore: () => void;

beforeEach(() => {
  db = createTestDb();
  restore = _setDb(db);
});

afterEach(() => {
  restore();
  db.close();
});

function insertProfile(
  agentId: string,
  side: "offering" | "seeking",
  category: string,
  params: Record<string, unknown>,
  description?: string
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, agentId, side, category, JSON.stringify(params), description ?? null);
  return id;
}

describe("findMatches", () => {
  it("matches offering to seeking in the same category", () => {
    const offerId = insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react", "typescript"],
      rate_min: 50,
      rate_max: 70,
    });
    insertProfile("bob", "seeking", "frontend-dev", {
      skills: ["react"],
      rate_min: 40,
      rate_max: 60,
    });

    const matches = findMatches(offerId);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.matching_skills).toContain("react");
    expect(matches[0].overlap.rate_overlap).toEqual({ min: 50, max: 60 });
    expect(matches[0].overlap.score).toBeGreaterThan(0);
  });

  it("does not match profiles on the same side", () => {
    const id1 = insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react"],
    });
    insertProfile("bob", "offering", "frontend-dev", {
      skills: ["react"],
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("does not match profiles in different categories", () => {
    const id1 = insertProfile("alice", "offering", "frontend-dev", {
      skills: ["react"],
    });
    insertProfile("bob", "seeking", "backend-dev", {
      skills: ["react"],
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("returns no match when skills don't overlap", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react", "vue"],
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["python", "rust"],
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("returns no match when rate ranges don't overlap", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      rate_min: 100,
      rate_max: 150,
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      rate_min: 30,
      rate_max: 50,
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("returns no match when remote preferences are incompatible", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      remote: "remote",
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      remote: "onsite",
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("matches when one side is hybrid", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
      remote: "remote",
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
      remote: "hybrid",
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.remote_compatible).toBe(true);
  });

  it("matches without rate params (optional)", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(1);
    expect(matches[0].overlap.rate_overlap).toBeNull();
  });

  it("creates a match record in the database", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(1);

    const matchRow = db.prepare("SELECT * FROM matches WHERE id = ?").get(matches[0].matchId) as Record<string, unknown>;
    expect(matchRow).toBeTruthy();
    expect(matchRow.status).toBe("matched");
  });

  it("reuses existing match on subsequent calls", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });

    const first = findMatches(id1);
    const second = findMatches(id1);
    expect(first[0].matchId).toBe(second[0].matchId);

    const matchCount = (db.prepare("SELECT COUNT(*) as c FROM matches").get() as { c: number }).c;
    expect(matchCount).toBe(1);
  });

  it("does not match inactive profiles", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react"],
    });
    const id2 = insertProfile("bob", "seeking", "dev", {
      skills: ["react"],
    });
    db.prepare("UPDATE profiles SET active = 0 WHERE id = ?").run(id2);

    const matches = findMatches(id1);
    expect(matches).toHaveLength(0);
  });

  it("sorts matches by score descending", () => {
    const id1 = insertProfile("alice", "offering", "dev", {
      skills: ["react", "typescript", "node"],
      rate_min: 50,
      rate_max: 70,
    });
    // Good match: 2 skills overlap + rate overlap
    insertProfile("bob", "seeking", "dev", {
      skills: ["react", "typescript"],
      rate_min: 50,
      rate_max: 65,
    });
    // Weaker match: 1 skill overlap + rate overlap
    insertProfile("charlie", "seeking", "dev", {
      skills: ["react", "python"],
      rate_min: 50,
      rate_max: 65,
    });

    const matches = findMatches(id1);
    expect(matches).toHaveLength(2);
    expect(matches[0].overlap.score).toBeGreaterThanOrEqual(matches[1].overlap.score);
    expect(matches[0].counterpart.agent_id).toBe("bob");
  });

  it("returns empty for non-existent profile", () => {
    const matches = findMatches("nonexistent-id");
    expect(matches).toHaveLength(0);
  });
});
