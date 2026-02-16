import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { GET } from "@/app/api/admin/stats/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";

let db: Client;
let restore: () => void;
const ADMIN_SECRET = "test-admin-secret-42";

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

afterEach(() => {
  restore();
  delete process.env.ADMIN_SECRET;
});

function getReq(url: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET", headers });
}

async function seedData() {
  // Create users
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    args: ["u1", "alice", "hash1"],
  });
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    args: ["u2", "bob", "hash2"],
  });

  // Create listings
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))",
    args: ["p1", "alice", "offering", "freelance-dev", '{"skills":["typescript","react"]}', "React dev"],
  });
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))",
    args: ["p2", "bob", "seeking", "freelance-dev", '{"skills":["typescript"]}', "Need dev"],
  });

  // Create a match
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, '{"matching_skills":["typescript"],"score":50}', 'negotiating', datetime('now'))`,
    args: ["m1", "p1", "p2"],
  });

  // Create a message
  await db.execute({
    sql: "INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, datetime('now'))",
    args: ["m1", "alice", "Hello!"],
  });
}

describe("Admin Stats API", () => {
  it("returns 503 when ADMIN_SECRET not configured", async () => {
    delete process.env.ADMIN_SECRET;
    const res = await GET(getReq("/api/admin/stats"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("not configured");
  });

  it("returns 401 without auth token", async () => {
    const res = await GET(getReq("/api/admin/stats"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const res = await GET(getReq("/api/admin/stats", "wrong-token"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid admin token", async () => {
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period_days).toBe(30);
    expect(body.generated_at).toBeDefined();
  });

  it("returns all stat sections", async () => {
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.agents).toBeDefined();
    expect(body.listings).toBeDefined();
    expect(body.deals).toBeDefined();
    expect(body.messages).toBeDefined();
    expect(body.bounties).toBeDefined();
    expect(body.reviews).toBeDefined();
    expect(body.webhooks).toBeDefined();
    expect(body.top_categories).toBeDefined();
  });

  it("counts agents correctly", async () => {
    await seedData();
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.agents.total).toBe(2);
    expect(body.agents.new_in_period).toBe(2);
    expect(body.agents.with_listings).toBe(2);
  });

  it("counts listings correctly", async () => {
    await seedData();
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.listings.total).toBe(2);
    expect(body.listings.active).toBe(2);
    expect(body.listings.offering).toBe(1);
    expect(body.listings.seeking).toBe(1);
    expect(body.listings.new_in_period).toBe(2);
  });

  it("counts deals by status", async () => {
    await seedData();
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.deals.total).toBe(1);
    expect(body.deals.by_status.negotiating).toBe(1);
    expect(body.deals.by_status.approved).toBe(0);
  });

  it("counts messages", async () => {
    await seedData();
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.messages.total).toBe(1);
    expect(body.messages.deals_with_messages).toBe(1);
  });

  it("shows top categories", async () => {
    await seedData();
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.top_categories.length).toBeGreaterThan(0);
    expect(body.top_categories[0].category).toBe("freelance-dev");
    expect(body.top_categories[0].count).toBe(2);
  });

  it("respects custom days parameter", async () => {
    const res = await GET(getReq("/api/admin/stats?days=7", ADMIN_SECRET));
    const body = await res.json();
    expect(body.period_days).toBe(7);
  });

  it("clamps days to valid range", async () => {
    const res = await GET(getReq("/api/admin/stats?days=999", ADMIN_SECRET));
    const body = await res.json();
    expect(body.period_days).toBe(365);
  });

  it("handles empty database", async () => {
    const res = await GET(getReq("/api/admin/stats", ADMIN_SECRET));
    const body = await res.json();
    expect(body.agents.total).toBe(0);
    expect(body.listings.total).toBe(0);
    expect(body.deals.total).toBe(0);
    expect(body.messages.total).toBe(0);
    expect(body.top_categories).toEqual([]);
  });
});
