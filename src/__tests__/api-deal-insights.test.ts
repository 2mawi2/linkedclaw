import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/insights/route";
import { getDealInsights } from "@/lib/deal-insights";
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

function req(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" });
}

async function insertProfile(
  category: string,
  side: string = "offering",
  rateMin: number = 50,
  rateMax: number = 100,
  active: number = 1,
) {
  const id = `p-${Math.random().toString(36).slice(2, 10)}`;
  const params = JSON.stringify({ rate_min: rateMin, rate_max: rateMax, skills: ["test"] });
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params, active, created_at)
          VALUES (?, 'agent1', ?, ?, ?, ?, datetime('now'))`,
    args: [id, side, category, params, active],
  });
  return id;
}

async function insertMatch(
  profileAId: string,
  profileBId: string,
  status: string,
  daysAgo: number = 0,
) {
  const id = `m-${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = daysAgo === 0 ? "datetime('now')" : `datetime('now', '-${daysAgo} days')`;
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, '{}', ?, ${createdAt})`,
    args: [id, profileAId, profileBId, status],
  });
  return id;
}

async function insertMessage(matchId: string, senderId: string = "agent1", content: string = "hi") {
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type)
          VALUES (?, ?, ?, 'negotiation')`,
    args: [matchId, senderId, content],
  });
}

describe("Deal Insights API", () => {
  it("returns valid response structure with empty db", async () => {
    const res = await GET(req("/api/insights"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.insights)).toBe(true);
    expect(data.insights.length).toBe(0);
    expect(data.filters).toEqual({ category: null, min_deals: 0 });
    expect(data.generated_at).toBeTruthy();
  });

  it("returns insights per category from deals", async () => {
    const p1 = await insertProfile("web-dev", "offering", 60, 100);
    const p2 = await insertProfile("web-dev", "seeking", 70, 120);
    const p3 = await insertProfile("ai-ml", "offering", 80, 150);
    const p4 = await insertProfile("ai-ml", "seeking", 90, 160);

    await insertMatch(p1, p2, "completed");
    await insertMatch(p3, p4, "approved");

    const res = await GET(req("/api/insights"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.insights.length).toBe(2);
    // Each should have expected fields
    const first = data.insights[0];
    expect(first).toHaveProperty("category");
    expect(first).toHaveProperty("total_deals");
    expect(first).toHaveProperty("completed_deals");
    expect(first).toHaveProperty("avg_rate_min");
    expect(first).toHaveProperty("avg_rate_max");
    expect(first).toHaveProperty("median_rate_min");
    expect(first).toHaveProperty("median_rate_max");
    expect(first).toHaveProperty("avg_time_to_close_hours");
    expect(first).toHaveProperty("avg_messages_per_deal");
    expect(first).toHaveProperty("completion_rate");
    expect(first).toHaveProperty("active_listings");
  });

  it("calculates rate averages from profile params", async () => {
    const p1 = await insertProfile("web-dev", "offering", 60, 100);
    const p2 = await insertProfile("web-dev", "seeking", 50, 80);
    await insertMatch(p1, p2, "completed");

    const res = await GET(req("/api/insights"));
    const data = await res.json();
    const insight = data.insights[0];
    expect(insight.avg_rate_min).toBe(60); // from profile_a
    expect(insight.avg_rate_max).toBe(100);
  });

  it("counts messages per deal", async () => {
    const p1 = await insertProfile("web-dev", "offering");
    const p2 = await insertProfile("web-dev", "seeking");
    const matchId = await insertMatch(p1, p2, "negotiating");

    await insertMessage(matchId, "agent1", "hello");
    await insertMessage(matchId, "agent2", "hi there");
    await insertMessage(matchId, "agent1", "lets deal");

    const res = await GET(req("/api/insights"));
    const data = await res.json();
    expect(data.insights[0].avg_messages_per_deal).toBe(3);
  });

  it("calculates completion rate correctly", async () => {
    const p1 = await insertProfile("web-dev", "offering");
    const p2 = await insertProfile("web-dev", "seeking");
    const p3 = await insertProfile("web-dev", "offering");
    const p4 = await insertProfile("web-dev", "seeking");

    await insertMatch(p1, p2, "completed");
    await insertMatch(p3, p4, "rejected");

    const res = await GET(req("/api/insights"));
    const data = await res.json();
    expect(data.insights[0].completion_rate).toBe(50); // 1 of 2
  });

  it("filters by category", async () => {
    const p1 = await insertProfile("web-dev", "offering");
    const p2 = await insertProfile("web-dev", "seeking");
    const p3 = await insertProfile("ai-ml", "offering");
    const p4 = await insertProfile("ai-ml", "seeking");

    await insertMatch(p1, p2, "completed");
    await insertMatch(p3, p4, "completed");

    const res = await GET(req("/api/insights?category=web-dev"));
    const data = await res.json();
    expect(data.insights.length).toBe(1);
    expect(data.insights[0].category).toBe("web-dev");
    expect(data.filters.category).toBe("web-dev");
  });

  it("filters by min_deals", async () => {
    const p1 = await insertProfile("popular", "offering");
    const p2 = await insertProfile("popular", "seeking");
    const p3 = await insertProfile("popular", "offering");
    const p4 = await insertProfile("popular", "seeking");
    const p5 = await insertProfile("rare", "offering");
    const p6 = await insertProfile("rare", "seeking");

    await insertMatch(p1, p2, "completed");
    await insertMatch(p3, p4, "negotiating");
    await insertMatch(p5, p6, "completed");

    const res = await GET(req("/api/insights?min_deals=2"));
    const data = await res.json();
    expect(data.insights.length).toBe(1);
    expect(data.insights[0].category).toBe("popular");
  });

  it("respects limit parameter", async () => {
    const cats = ["cat-a", "cat-b", "cat-c"];
    for (const cat of cats) {
      const pa = await insertProfile(cat, "offering");
      const pb = await insertProfile(cat, "seeking");
      await insertMatch(pa, pb, "completed");
    }

    const res = await GET(req("/api/insights?limit=2"));
    const data = await res.json();
    expect(data.insights.length).toBe(2);
  });

  it("rejects invalid limit", async () => {
    const res = await GET(req("/api/insights?limit=0"));
    expect(res.status).toBe(400);

    const res2 = await GET(req("/api/insights?limit=100"));
    expect(res2.status).toBe(400);
  });

  it("rejects negative min_deals", async () => {
    const res = await GET(req("/api/insights?min_deals=-1"));
    expect(res.status).toBe(400);
  });

  it("counts active listings per category", async () => {
    const p1 = await insertProfile("web-dev", "offering", 50, 100, 1);
    const p2 = await insertProfile("web-dev", "seeking", 50, 100, 1);
    await insertProfile("web-dev", "offering", 50, 100, 0); // inactive
    await insertMatch(p1, p2, "completed");

    const res = await GET(req("/api/insights"));
    const data = await res.json();
    expect(data.insights[0].active_listings).toBe(2); // only active ones
  });

  it("handles deals with no rate info gracefully", async () => {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, active)
            VALUES (?, 'agent1', 'offering', 'no-rates', '{}', 1)`,
      args: [id],
    });
    const id2 = `p-${Math.random().toString(36).slice(2, 10)}`;
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params, active)
            VALUES (?, 'agent2', 'seeking', 'no-rates', '{}', 1)`,
      args: [id2],
    });
    await insertMatch(id, id2, "completed");

    const res = await GET(req("/api/insights"));
    const data = await res.json();
    expect(data.insights[0].avg_rate_min).toBeNull();
    expect(data.insights[0].avg_rate_max).toBeNull();
    expect(data.insights[0].median_rate_min).toBeNull();
    expect(data.insights[0].median_rate_max).toBeNull();
  });

  describe("getDealInsights unit", () => {
    it("returns empty for empty db", async () => {
      const result = await getDealInsights(db);
      expect(result).toEqual([]);
    });

    it("caps limit at 50", async () => {
      const result = await getDealInsights(db, { limit: 999 });
      expect(result.length).toBe(0);
    });

    it("computes median correctly for even count", async () => {
      // 4 profiles with different rates
      const rates = [
        [40, 80],
        [60, 100],
        [80, 120],
        [100, 140],
      ];
      const ids: string[] = [];
      for (const [rmin, rmax] of rates) {
        ids.push(await insertProfile("test-cat", "offering", rmin, rmax));
      }
      // Create matches using each as profile_a
      for (let i = 0; i < ids.length; i++) {
        const seekId = await insertProfile("test-cat", "seeking");
        await insertMatch(ids[i], seekId, "completed");
      }

      const result = await getDealInsights(db, { category: "test-cat" });
      expect(result.length).toBe(1);
      // Median of [40, 60, 80, 100] = (60+80)/2 = 70
      expect(result[0].median_rate_min).toBe(70);
      // Median of [80, 100, 120, 140] = (100+120)/2 = 110
      expect(result[0].median_rate_max).toBe(110);
    });
  });
});
