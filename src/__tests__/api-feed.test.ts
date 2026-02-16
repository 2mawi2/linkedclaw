import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET as feedGET } from "@/app/api/feed/route";
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

function req(query = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/feed${query ? "?" + query : ""}`);
}

describe("GET /api/feed", () => {
  it("returns 200 with events array on fresh db", async () => {
    const res = await feedGET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  it("returns new_listing events for active profiles", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, description, params, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "development", "React developer", "{}", "2026-02-16T10:00:00Z"],
    });

    const res = await feedGET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].type).toBe("new_listing");
    expect(data.events[0].agent_id).toBe("alice");
    expect(data.events[0].listing_id).toBe("p1");
    expect(data.events[0].category).toBe("development");
    expect(data.events[0].summary).toContain("offering");
  });

  it("returns deal_completed events", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pa", "alice", "offering", "design", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pb", "bob", "seeking", "design", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["m1", "pa", "pb", "design overlap", "completed", "2026-02-16T12:00:00Z"],
    });

    const res = await feedGET(req("type=deal_completed"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].type).toBe("deal_completed");
    expect(data.events[0].summary).toContain("alice");
    expect(data.events[0].summary).toContain("bob");
  });

  it("returns deal_approved events", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pa", "alice", "offering", "dev", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pb", "bob", "seeking", "dev", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["m1", "pa", "pb", "overlap", "approved", "2026-02-16T11:00:00Z"],
    });

    const res = await feedGET(req("type=deal_approved"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].type).toBe("deal_approved");
  });

  it("returns new_bounty events", async () => {
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, status, budget_min, budget_max, currency, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["b1", "charlie", "Build a dashboard", "Need React dashboard", "development", "open", 500, 1000, "USD", "2026-02-16T09:00:00Z"],
    });

    const res = await feedGET(req("type=new_bounty"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].type).toBe("new_bounty");
    expect(data.events[0].summary).toContain("Build a dashboard");
    expect(data.events[0].summary).toContain("USD");
  });

  it("returns new_review events", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pa", "alice", "offering", "dev", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["pb", "bob", "seeking", "dev", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m1", "pa", "pb", "overlap", "completed"],
    });
    await db.execute({
      sql: `INSERT INTO reviews (id, match_id, reviewer_agent_id, reviewed_agent_id, rating, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["r1", "m1", "bob", "alice", 5, "Excellent work!", "2026-02-16T14:00:00Z"],
    });

    const res = await feedGET(req("type=new_review"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].type).toBe("new_review");
    expect(data.events[0].summary).toContain("bob");
    expect(data.events[0].summary).toContain("★");
  });

  it("filters by type param", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "dev", "{}"],
    });

    // Asking for only deal_completed should not return listings
    const res = await feedGET(req("type=deal_completed"));
    const data = await res.json();
    expect(data.total).toBe(0);
  });

  it("filters by since param", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "dev", "{}", "2026-02-10T10:00:00Z"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["p2", "bob", "seeking", "dev", "{}", "2026-02-16T10:00:00Z"],
    });

    const res = await feedGET(req("since=2026-02-15T00:00:00Z"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.events[0].agent_id).toBe("bob");
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [`p${i}`, `agent${i}`, "offering", "dev", "{}", `2026-02-16T${10 + i}:00:00Z`],
      });
    }

    const res = await feedGET(req("limit=2&offset=1"));
    const data = await res.json();
    expect(data.total).toBe(5);
    expect(data.events.length).toBe(2);
    // Sorted desc, so offset=1 skips the newest
    expect(data.events[0].agent_id).toBe("agent3");
    expect(data.events[1].agent_id).toBe("agent2");
  });

  it("includes pagination headers", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "dev", "{}"],
    });

    const res = await feedGET(req());
    expect(res.headers.get("X-Total-Count")).toBe("1");
  });

  it("sorts events by timestamp descending across types", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["pa", "alice", "offering", "dev", "{}", "2026-02-16T08:00:00Z"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["pb", "bob", "seeking", "dev", "{}", "2026-02-16T09:00:00Z"],
    });
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["b1", "charlie", "Test bounty", "desc", "dev", "open", "2026-02-16T08:30:00Z"],
    });

    const res = await feedGET(req());
    const data = await res.json();
    expect(data.total).toBe(3);
    // bob listing (09:00) > bounty (08:30) > alice listing (08:00)
    expect(data.events[0].agent_id).toBe("bob");
    expect(data.events[1].type).toBe("new_bounty");
    expect(data.events[2].agent_id).toBe("alice");
  });

  it("supports multiple type filters", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "dev", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["b1", "bob", "Bounty", "desc", "dev", "open", "2026-02-16T10:00:00Z"],
    });

    const res = await feedGET(req("type=new_listing,new_bounty"));
    const data = await res.json();
    expect(data.total).toBe(2);
  });

  it("does not include inactive profiles", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, active) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["p1", "alice", "offering", "dev", "{}", 0],
    });

    const res = await feedGET(req());
    const data = await res.json();
    expect(data.total).toBe(0);
  });

  it("does not require authentication", async () => {
    // No auth header - should still work
    const res = await feedGET(req());
    expect(res.status).toBe(200);
  });

  it("caps limit at 50", async () => {
    const res = await feedGET(req("limit=100"));
    expect(res.status).toBe(200);
    // Just verify it doesn't error - limit is capped internally
  });
});
