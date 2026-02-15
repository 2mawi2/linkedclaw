import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET as portfolioGET } from "@/app/api/agents/[agentId]/portfolio/route";
import { GET as summaryGET } from "@/app/api/agents/[agentId]/summary/route";
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

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" });
}

async function insertProfile(
  agentId: string,
  side: string,
  category: string,
  opts: { active?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params, active, created_at)
          VALUES (?, ?, ?, ?, '{}', ?, datetime('now'))`,
    args: [id, agentId, side, category, opts.active ?? 1],
  });
  return id;
}

async function insertMatch(
  profileAId: string,
  profileBId: string,
  status = "matched",
): Promise<string> {
  const matchId = crypto.randomUUID();
  const [aId, bId] = profileAId < profileBId ? [profileAId, profileBId] : [profileBId, profileAId];
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status)
          VALUES (?, ?, ?, ?, ?)`,
    args: [matchId, aId, bId, JSON.stringify({ matching_skills: ["test"], score: 80 }), status],
  });
  return matchId;
}

async function insertReview(
  matchId: string,
  reviewerAgentId: string,
  reviewedAgentId: string,
  rating: number,
  comment: string | null = null,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO reviews (id, match_id, reviewer_agent_id, reviewed_agent_id, rating, comment)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), matchId, reviewerAgentId, reviewedAgentId, rating, comment],
  });
}

async function insertMilestone(matchId: string, title: string, status = "pending"): Promise<void> {
  await db.execute({
    sql: `INSERT INTO deal_milestones (id, match_id, title, status, created_by)
          VALUES (?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), matchId, title, status, "test"],
  });
}

describe("GET /api/agents/:agentId/portfolio", () => {
  it("returns 404 for unknown agent", async () => {
    const res = await portfolioGET(getReq("/api/agents/nobody/portfolio"), {
      params: Promise.resolve({ agentId: "nobody" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns empty portfolio for agent with no deals", async () => {
    await insertProfile("alice", "offering", "dev");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.agent_id).toBe("alice");
    expect(data.completed_deals).toHaveLength(0);
    expect(data.verified_categories).toHaveLength(0);
    expect(data.badges).toHaveLength(0);
    expect(data.stats.total_completed).toBe(0);
  });

  it("shows completed deals in portfolio", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(a, b, "completed");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.completed_deals).toHaveLength(1);
    expect(data.completed_deals[0].deal_id).toBe(matchId);
    expect(data.completed_deals[0].category).toBe("dev");
    expect(data.completed_deals[0].side).toBe("offering");
    expect(data.completed_deals[0].status).toBe("completed");
    expect(data.completed_deals[0].counterpart_agent_id).toBe("bob");
    expect(data.stats.total_completed).toBe(1);
  });

  it("includes in_progress deals", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a, b, "in_progress");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.completed_deals).toHaveLength(1);
    expect(data.completed_deals[0].status).toBe("in_progress");
    expect(data.stats.total_in_progress).toBe(1);
    expect(data.stats.total_completed).toBe(0);
  });

  it("excludes rejected/expired/matched deals", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const c = await insertProfile("charlie", "seeking", "dev");
    const d = await insertProfile("dave", "seeking", "dev");

    await insertMatch(a, b, "rejected");
    await insertMatch(a, c, "matched");
    await insertMatch(a, d, "completed");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.completed_deals).toHaveLength(1);
    expect(data.completed_deals[0].counterpart_agent_id).toBe("dave");
  });

  it("includes ratings received", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(a, b, "completed");
    await insertReview(matchId, "bob", "alice", 5, "Excellent work!");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.completed_deals[0].rating_received).toEqual({
      rating: 5,
      comment: "Excellent work!",
      from: "bob",
    });
    expect(data.stats.avg_rating_received).toBe(5);
    expect(data.stats.total_ratings).toBe(1);
  });

  it("includes milestone stats", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(a, b, "completed");
    await insertMilestone(matchId, "Phase 1", "completed");
    await insertMilestone(matchId, "Phase 2", "completed");
    await insertMilestone(matchId, "Phase 3", "pending");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.completed_deals[0].milestones).toEqual({ total: 3, completed: 2 });
  });

  it("computes verified categories from completed deals", async () => {
    const a1 = await insertProfile("alice", "offering", "dev");
    const b1 = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a1, b1, "completed");

    const a2 = await insertProfile("alice", "offering", "dev");
    const b2 = await insertProfile("charlie", "seeking", "dev");
    await insertMatch(a2, b2, "completed");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.verified_categories).toHaveLength(1);
    expect(data.verified_categories[0].category).toBe("dev");
    expect(data.verified_categories[0].completed_deals).toBe(2);
    expect(data.verified_categories[0].level).toBe("bronze");
  });

  it("assigns correct verification levels", async () => {
    // Create 3 completed deals in "dev" for silver
    for (let i = 0; i < 3; i++) {
      const a = await insertProfile("alice", "offering", "dev");
      const b = await insertProfile(`bob${i}`, "seeking", "dev");
      await insertMatch(a, b, "completed");
    }

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.verified_categories[0].level).toBe("silver");
  });

  it("awards first_deal badge", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a, b, "completed");

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.badges.some((b: { id: string }) => b.id === "first_deal")).toBe(true);
  });

  it("awards highly_rated badge with 3+ high ratings", async () => {
    for (let i = 0; i < 3; i++) {
      const a = await insertProfile("alice", "offering", "dev");
      const b = await insertProfile(`reviewer${i}`, "seeking", "dev");
      const matchId = await insertMatch(a, b, "completed");
      await insertReview(matchId, `reviewer${i}`, "alice", 5);
    }

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.badges.some((b: { id: string }) => b.id === "highly_rated")).toBe(true);
    expect(data.badges.some((b: { id: string }) => b.id === "exceptional")).toBe(true);
  });

  it("no highly_rated badge with low ratings", async () => {
    for (let i = 0; i < 3; i++) {
      const a = await insertProfile("alice", "offering", "dev");
      const b = await insertProfile(`reviewer${i}`, "seeking", "dev");
      const matchId = await insertMatch(a, b, "completed");
      await insertReview(matchId, `reviewer${i}`, "alice", 2);
    }

    const res = await portfolioGET(getReq("/api/agents/alice/portfolio"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.badges.some((b: { id: string }) => b.id === "highly_rated")).toBe(false);
  });
});

describe("GET /api/agents/:agentId/summary - verified categories & badges", () => {
  it("includes verified_categories and badges in summary", async () => {
    await insertProfile("alice", "offering", "dev");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data).toHaveProperty("verified_categories");
    expect(data).toHaveProperty("badges");
    expect(data.verified_categories).toEqual([]);
    expect(data.badges).toEqual([]);
  });

  it("shows verified categories for completed deals", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a, b, "completed");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.verified_categories).toHaveLength(1);
    expect(data.verified_categories[0].category).toBe("dev");
    expect(data.verified_categories[0].completed_deals).toBe(1);
    expect(data.verified_categories[0].level).toBe("bronze");
  });

  it("awards first_deal badge in summary", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a, b, "completed");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.badges).toHaveLength(1);
    expect(data.badges[0].id).toBe("first_deal");
  });

  it("awards highly_rated badge when reputation qualifies", async () => {
    // Create completed deals with reviews
    for (let i = 0; i < 3; i++) {
      const a = await insertProfile("alice", "offering", "dev");
      const b = await insertProfile(`r${i}`, "seeking", "dev");
      const matchId = await insertMatch(a, b, "completed");
      await insertReview(matchId, `r${i}`, "alice", 5);
    }

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    const badgeIds = data.badges.map((b: { id: string }) => b.id);
    expect(badgeIds).toContain("first_deal");
    // 3 deals = first_deal only (prolific needs 5)
    expect(badgeIds).not.toContain("prolific");
    expect(badgeIds).toContain("highly_rated");
    expect(badgeIds).toContain("exceptional");
  });
});
