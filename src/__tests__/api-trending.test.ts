import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/trending/route";
import { getTrendingCategories } from "@/lib/trending";
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

async function insertProfile(category: string, side: string = "offering", daysAgo: number = 0) {
  const id = `p-${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = daysAgo === 0 ? "datetime('now')" : `datetime('now', '-${daysAgo} days')`;
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params, active, created_at)
          VALUES (?, 'agent1', ?, ?, '{}', 1, ${createdAt})`,
    args: [id, side, category],
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

describe("Trending Categories API", () => {
  it("returns valid response structure", async () => {
    const res = await GET(req("/api/trending"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.trending)).toBe(true);
    expect(data.period).toEqual({ short: "7d", long: "30d" });
    expect(data.generated_at).toBeTruthy();
    // Each entry has expected fields
    if (data.trending.length > 0) {
      const first = data.trending[0];
      expect(first).toHaveProperty("category");
      expect(first).toHaveProperty("new_listings_7d");
      expect(first).toHaveProperty("deals_closed_7d");
      expect(first).toHaveProperty("growth_rate");
      expect(first).toHaveProperty("trend_score");
    }
  });

  it("returns trending categories sorted by trend score", async () => {
    // "web-dev" gets 3 recent listings
    await insertProfile("web-dev", "offering", 1);
    await insertProfile("web-dev", "offering", 2);
    await insertProfile("web-dev", "seeking", 3);

    // "data-science" gets 1 recent listing
    await insertProfile("data-science", "offering", 1);

    const res = await GET(req("/api/trending"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trending.length).toBe(2);
    expect(data.trending[0].category).toBe("web-dev");
    expect(data.trending[0].new_listings_7d).toBe(3);
    expect(data.trending[1].category).toBe("data-science");
    expect(data.trending[1].new_listings_7d).toBe(1);
  });

  it("includes deal closures in scoring", async () => {
    const p1 = await insertProfile("ai-ml", "offering", 1);
    const p2 = await insertProfile("ai-ml", "seeking", 1);
    const p3 = await insertProfile("ai-ml", "offering", 2);
    const p4 = await insertProfile("ai-ml", "seeking", 2);
    await insertMatch(p1, p2, "approved", 1);
    await insertMatch(p3, p4, "completed", 2);

    // web-dev has more listings but no deals
    await insertProfile("web-dev", "offering", 1);
    await insertProfile("web-dev", "offering", 2);
    await insertProfile("web-dev", "offering", 3);

    const res = await GET(req("/api/trending"));
    const data = await res.json();
    // ai-ml: 4 listings * 3 + 2 deals * 5 = 22
    // web-dev: 3 listings * 3 + 0 deals = 9
    expect(data.trending[0].category).toBe("ai-ml");
    expect(data.trending[0].deals_closed_7d).toBe(2);
  });

  it("respects limit parameter", async () => {
    await insertProfile("cat-a", "offering", 1);
    await insertProfile("cat-b", "offering", 1);
    await insertProfile("cat-c", "offering", 1);

    const res = await GET(req("/api/trending?limit=2"));
    const data = await res.json();
    expect(data.trending.length).toBe(2);
  });

  it("rejects invalid limit", async () => {
    const res = await GET(req("/api/trending?limit=0"));
    expect(res.status).toBe(400);

    const res2 = await GET(req("/api/trending?limit=100"));
    expect(res2.status).toBe(400);
  });

  it("rejects negative min_listings", async () => {
    const res = await GET(req("/api/trending?min_listings=-1"));
    expect(res.status).toBe(400);
  });

  it("filters by min_listings", async () => {
    await insertProfile("popular", "offering", 1);
    await insertProfile("popular", "offering", 2);
    await insertProfile("popular", "offering", 5);
    await insertProfile("rare", "offering", 1);

    const res = await GET(req("/api/trending?min_listings=2"));
    const data = await res.json();
    expect(data.trending.length).toBe(1);
    expect(data.trending[0].category).toBe("popular");
  });

  it("calculates growth rate", async () => {
    // 3 listings this week, 1 listing prior week
    await insertProfile("growing", "offering", 1);
    await insertProfile("growing", "offering", 2);
    await insertProfile("growing", "offering", 3);
    await insertProfile("growing", "offering", 10); // prior period

    const res = await GET(req("/api/trending"));
    const data = await res.json();
    expect(data.trending[0].growth_rate).toBe(200); // 3 vs 1 = 200%
  });

  it("excludes old listings from 7d count", async () => {
    await insertProfile("old-cat", "offering", 20);
    await insertProfile("old-cat", "offering", 25);

    const res = await GET(req("/api/trending"));
    const data = await res.json();
    // Only in 30d, not in 7d
    expect(data.trending[0].new_listings_7d).toBe(0);
    expect(data.trending[0].new_listings_30d).toBe(2);
  });

  it("handles growth rate when prior period has no listings", async () => {
    await insertProfile("new-cat", "offering", 1);

    const res = await GET(req("/api/trending"));
    const data = await res.json();
    expect(data.trending[0].growth_rate).toBe(100); // new with no prior = 100%
  });

  describe("getTrendingCategories unit", () => {
    it("returns empty for empty db", async () => {
      const result = await getTrendingCategories(db);
      expect(result).toEqual([]);
    });

    it("caps limit at 50", async () => {
      const result = await getTrendingCategories(db, { limit: 999 });
      expect(result.length).toBe(0); // no data, but limit is capped
    });

    it("floors limit at 1", async () => {
      await insertProfile("cat-a", "offering", 1);
      await insertProfile("cat-b", "offering", 1);
      const result = await getTrendingCategories(db, { limit: 0 });
      expect(result.length).toBe(1);
    });
  });
});
