import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { GET, POST } from "@/app/api/deals/expiry/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";
import { validateExpiryConfig, expireStaleDeals, previewStaleDeals } from "@/lib/deal-auto-expiry";

let db: Client;
let restore: () => void;
const ADMIN_SECRET = "test-admin-secret-99";

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

function postReq(url: string, body?: object, token?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seedStaleDeals() {
  // Create two users with profiles
  // Create users
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    args: ["u1", "alice", "hash1"],
  });
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    args: ["u2", "bob", "hash2"],
  });

  // Create multiple profiles so each match can have a unique (profile_a_id, profile_b_id) pair
  for (const [id, agent, side] of [
    ["p1a", "u1", "offering"], ["p1b", "u1", "offering"], ["p1c", "u1", "offering"], ["p1d", "u1", "offering"],
    ["p2a", "u2", "seeking"], ["p2b", "u2", "seeking"], ["p2c", "u2", "seeking"], ["p2d", "u2", "seeking"],
  ] as const) {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, description, category, params, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [id, agent, side, "Service", "freelance-dev", "{}"],
    });
  }

  // Create a stale deal (10 days old, negotiating)
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["m1", "p1a", "p2a", "typescript", "negotiating", tenDaysAgo],
  });

  // Create a stale deal (8 days old, matched)
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["m2", "p1b", "p2b", "react", "matched", eightDaysAgo],
  });

  // Create a fresh deal (1 day old, negotiating - should NOT be expired)
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["m3", "p1c", "p2c", "node", "negotiating", oneDayAgo],
  });

  // Create a completed deal (old but should NOT be expired)
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["m4", "p1d", "p2d", "python", "completed", tenDaysAgo],
  });
}

describe("validateExpiryConfig", () => {
  it("returns defaults when no params", () => {
    const config = validateExpiryConfig();
    expect(config.timeoutHours).toBe(168);
    expect(config.limit).toBe(100);
  });

  it("accepts valid custom values", () => {
    const config = validateExpiryConfig(48, 50);
    expect(config.timeoutHours).toBe(48);
    expect(config.limit).toBe(50);
  });

  it("rejects timeout_hours out of range", () => {
    expect(() => validateExpiryConfig(0)).toThrow();
    expect(() => validateExpiryConfig(9000)).toThrow();
  });

  it("rejects limit out of range", () => {
    expect(() => validateExpiryConfig(168, 0)).toThrow();
    expect(() => validateExpiryConfig(168, 501)).toThrow();
  });
});

describe("expireStaleDeals", () => {
  it("expires deals older than timeout", async () => {
    await seedStaleDeals();
    const config = validateExpiryConfig(168); // 7 days
    const result = await expireStaleDeals(db, config);

    expect(result.expired_count).toBe(2); // m1 (10 days) and m2 (8 days)
    expect(result.expired_deals.map((d) => d.id).sort()).toEqual(["m1", "m2"]);
    expect(result.timeout_hours).toBe(168);
    expect(result.swept_at).toBeTruthy();

    // Verify status changed in DB
    const m1 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m1"] });
    expect((m1.rows[0] as unknown as { status: string }).status).toBe("expired");

    const m2 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m2"] });
    expect((m2.rows[0] as unknown as { status: string }).status).toBe("expired");

    // Fresh deal should NOT be expired
    const m3 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m3"] });
    expect((m3.rows[0] as unknown as { status: string }).status).toBe("negotiating");

    // Completed deal should NOT be expired
    const m4 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m4"] });
    expect((m4.rows[0] as unknown as { status: string }).status).toBe("completed");
  });

  it("sends notifications to both parties", async () => {
    await seedStaleDeals();
    const config = validateExpiryConfig(168);
    await expireStaleDeals(db, config);

    const notifs = await db.execute({ sql: "SELECT * FROM notifications WHERE type = 'deal_expired'", args: [] });
    // 2 deals expired, 2 parties each = 4 notifications
    expect(notifs.rows.length).toBe(4);
  });

  it("returns empty when no stale deals", async () => {
    await seedStaleDeals();
    const config = validateExpiryConfig(8760); // 1 year timeout
    const result = await expireStaleDeals(db, config);
    expect(result.expired_count).toBe(0);
    expect(result.expired_deals).toEqual([]);
  });
});

describe("previewStaleDeals", () => {
  it("previews without modifying data", async () => {
    await seedStaleDeals();
    const config = validateExpiryConfig(168);
    const result = await previewStaleDeals(db, config);

    expect(result.stale_count).toBe(2);
    expect(result.stale_deals.length).toBe(2);

    // Verify status NOT changed
    const m1 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m1"] });
    expect((m1.rows[0] as unknown as { status: string }).status).toBe("negotiating");
  });
});

describe("GET /api/deals/expiry", () => {
  it("requires admin auth", async () => {
    const res = await GET(getReq("/api/deals/expiry"));
    expect(res.status).toBe(401);
  });

  it("returns 503 without ADMIN_SECRET", async () => {
    delete process.env.ADMIN_SECRET;
    const res = await GET(getReq("/api/deals/expiry", "anything"));
    expect(res.status).toBe(503);
  });

  it("previews stale deals", async () => {
    await seedStaleDeals();
    const res = await GET(getReq("/api/deals/expiry?timeout_hours=168", ADMIN_SECRET));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stale_count).toBe(2);
    expect(data.timeout_hours).toBe(168);
  });

  it("respects custom timeout_hours", async () => {
    await seedStaleDeals();
    // 9 day timeout: only m1 (10 days old) should be stale
    const res = await GET(getReq("/api/deals/expiry?timeout_hours=216", ADMIN_SECRET));
    const data = await res.json();
    expect(data.stale_count).toBe(1);
    expect(data.stale_deals[0].id).toBe("m1");
  });
});

describe("POST /api/deals/expiry", () => {
  it("requires admin auth", async () => {
    const res = await POST(postReq("/api/deals/expiry"));
    expect(res.status).toBe(401);
  });

  it("expires stale deals", async () => {
    await seedStaleDeals();
    const res = await POST(postReq("/api/deals/expiry", { timeout_hours: 168 }, ADMIN_SECRET));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.expired_count).toBe(2);
  });

  it("supports dry_run", async () => {
    await seedStaleDeals();
    const res = await POST(
      postReq("/api/deals/expiry", { timeout_hours: 168, dry_run: true }, ADMIN_SECRET)
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.dry_run).toBe(true);
    expect(data.stale_count).toBe(2);

    // Verify nothing was expired
    const m1 = await db.execute({ sql: "SELECT status FROM matches WHERE id = ?", args: ["m1"] });
    expect((m1.rows[0] as unknown as { status: string }).status).toBe("negotiating");
  });

  it("rejects invalid timeout_hours", async () => {
    const res = await POST(
      postReq("/api/deals/expiry", { timeout_hours: 0 }, ADMIN_SECRET)
    );
    expect(res.status).toBe(400);
  });
});
