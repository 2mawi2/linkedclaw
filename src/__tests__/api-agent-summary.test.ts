import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
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

/** Insert a profile directly in the DB */
async function insertProfile(
  agentId: string,
  side: string,
  category: string,
  opts: { description?: string; active?: number; createdAt?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params, description, active, created_at)
          VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`,
    args: [
      id,
      agentId,
      side,
      category,
      opts.description ?? null,
      opts.active ?? 1,
      opts.createdAt ?? new Date().toISOString().replace("T", " ").slice(0, 19),
    ],
  });
  return id;
}

/** Insert a match directly in the DB */
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
    args: [matchId, aId, bId, JSON.stringify({ matching_skills: ["react"], score: 80 }), status],
  });
  return matchId;
}

/** Insert a message directly */
async function insertMessage(
  matchId: string,
  senderAgentId: string,
  content: string,
  messageType = "negotiation",
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, ?)`,
    args: [matchId, senderAgentId, content, messageType],
  });
}

describe("GET /api/agents/:agentId/summary", () => {
  it("returns 404 for unknown agent", async () => {
    const res = await summaryGET(getReq("/api/agents/nobody/summary"), {
      params: Promise.resolve({ agentId: "nobody" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns basic summary for agent with one profile", async () => {
    await insertProfile("alice", "offering", "dev", { description: "I build things" });

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.agent_id).toBe("alice");
    expect(data.profile_count).toBe(1);
    expect(data.active_profiles).toHaveLength(1);
    expect(data.active_profiles[0].side).toBe("offering");
    expect(data.active_profiles[0].category).toBe("dev");
    expect(data.active_profiles[0].description).toBe("I build things");
    expect(data.match_stats.total_matches).toBe(0);
    expect(data.match_stats.active_deals).toBe(0);
    expect(data.match_stats.completed_deals).toBe(0);
    expect(data.match_stats.success_rate).toBe(0);
    expect(data.recent_activity).toHaveLength(0);
    expect(data.member_since).toBeTruthy();
    expect(data.category_breakdown).toEqual({ dev: 1 });
  });

  it("returns correct match stats", async () => {
    const offeringId = await insertProfile("alice", "offering", "dev");
    const seekingId = await insertProfile("bob", "seeking", "dev");
    await insertMatch(offeringId, seekingId, "matched");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.match_stats.total_matches).toBe(1);
    expect(data.match_stats.active_deals).toBe(1);
  });

  it("includes recent activity from messages", async () => {
    const offeringId = await insertProfile("alice", "offering", "dev");
    const seekingId = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(offeringId, seekingId);

    await insertMessage(matchId, "alice", "Hello Bob!", "negotiation");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.recent_activity).toHaveLength(1);
    expect(data.recent_activity[0].type).toBe("negotiation");
    expect(data.recent_activity[0].content).toBe("Hello Bob!");
    expect(data.recent_activity[0].match_id).toBe(matchId);
  });

  it("tracks completed deals and success rate", async () => {
    const a1 = await insertProfile("alice", "offering", "dev");
    const b1 = await insertProfile("bob", "seeking", "dev");
    await insertMatch(a1, b1, "approved");

    const a2 = await insertProfile("alice", "offering", "design");
    const b2 = await insertProfile("bob", "seeking", "design");
    await insertMatch(a2, b2, "rejected");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.match_stats.total_matches).toBe(2);
    expect(data.match_stats.completed_deals).toBe(1);
    expect(data.match_stats.success_rate).toBe(0.5);
    expect(data.match_stats.active_deals).toBe(0);
  });

  it("shows category breakdown with multiple categories", async () => {
    await insertProfile("alice", "offering", "dev");
    await insertProfile("alice", "seeking", "design");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.profile_count).toBe(2);
    expect(data.category_breakdown).toEqual({ dev: 1, design: 1 });
  });

  it("excludes inactive profiles from count but keeps member_since", async () => {
    await insertProfile("alice", "offering", "dev", {
      active: 0,
      createdAt: "2024-01-01 00:00:00",
    });

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.profile_count).toBe(0);
    expect(data.active_profiles).toHaveLength(0);
    expect(data.member_since).toBe("2024-01-01 00:00:00");
  });

  it("limits recent activity to 5 events", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(a, b);

    for (let i = 0; i < 7; i++) {
      await insertMessage(matchId, "alice", `Message ${i}`);
    }

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.recent_activity).toHaveLength(5);
  });

  it("only shows messages from the requested agent", async () => {
    const a = await insertProfile("alice", "offering", "dev");
    const b = await insertProfile("bob", "seeking", "dev");
    const matchId = await insertMatch(a, b);

    await insertMessage(matchId, "alice", "From Alice");
    await insertMessage(matchId, "bob", "From Bob");

    const res = await summaryGET(getReq("/api/agents/alice/summary"), {
      params: Promise.resolve({ agentId: "alice" }),
    });
    const data = await res.json();

    expect(data.recent_activity).toHaveLength(1);
    expect(data.recent_activity[0].content).toBe("From Alice");
  });
});
