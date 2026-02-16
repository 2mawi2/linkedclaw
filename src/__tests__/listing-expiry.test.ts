import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, _setDb } from "@/lib/db";
import { migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import {
  expireStaleListings,
  getExpiringListings,
  renewListing,
  LISTING_LIFETIME_DAYS,
} from "@/lib/listing-expiry";

let db: Client;
let restore: () => void;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);

  // Create a test agent + API key
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    args: ["user1", "testuser", "hash"],
  });
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
    args: ["key1", "agent1", "user1", "keyhash1"],
  });

  return () => restore();
});

describe("Listing Expiry", () => {
  it("expireStaleListings deactivates expired profiles", async () => {
    // Insert a listing that expired yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p1", "agent1", "offering", "dev", "{}", yesterday],
    });

    const count = await expireStaleListings(db);
    expect(count).toBe(1);

    // Profile should now be inactive
    const result = await db.execute({
      sql: "SELECT active FROM profiles WHERE id = 'p1'",
      args: [],
    });
    expect(result.rows[0]!.active).toBe(0);
  });

  it("expireStaleListings ignores active non-expired profiles", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p2", "agent1", "offering", "dev", "{}", future],
    });

    const count = await expireStaleListings(db);
    expect(count).toBe(0);

    const result = await db.execute({
      sql: "SELECT active FROM profiles WHERE id = 'p2'",
      args: [],
    });
    expect(result.rows[0]!.active).toBe(1);
  });

  it("expireStaleListings creates notification for expired listing", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p3", "agent1", "offering", "design", "{}", yesterday],
    });

    await expireStaleListings(db);

    const notifs = await db.execute({
      sql: "SELECT * FROM notifications WHERE agent_id = 'agent1' AND type = 'listing_expired'",
      args: [],
    });
    expect(notifs.rows.length).toBe(1);
    expect(notifs.rows[0]!.summary).toContain("design");
    expect(notifs.rows[0]!.summary).toContain("expired");
  });

  it("getExpiringListings returns listings expiring within N days", async () => {
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p4", "agent1", "offering", "dev", "{}", in3Days],
    });
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p5", "agent1", "seeking", "design", "{}", in10Days],
    });

    const expiring7 = await getExpiringListings(db, 7);
    expect(expiring7.length).toBe(1);
    expect(expiring7[0]!.id).toBe("p4");

    const expiring14 = await getExpiringListings(db, 14);
    expect(expiring14.length).toBe(2);
  });

  it("getExpiringListings excludes inactive profiles", async () => {
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["p6", "agent1", "offering", "dev", "{}", in3Days, 0],
    });

    const expiring = await getExpiringListings(db, 7);
    expect(expiring.length).toBe(0);
  });

  it("renewListing extends expiry by 30 days", async () => {
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p7", "agent1", "offering", "dev", "{}", in3Days],
    });

    const result = await renewListing(db, "p7", "agent1");
    expect(result.renewed).toBe(true);
    expect(result.reactivated).toBe(false);

    // Check new expiry is ~30 days from now
    const newExpiry = new Date(result.expires_at).getTime();
    const expected = Date.now() + LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(newExpiry - expected)).toBeLessThan(5000); // within 5 seconds
  });

  it("renewListing reactivates expired listing", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["p8", "agent1", "offering", "dev", "{}", yesterday, 0],
    });

    const result = await renewListing(db, "p8", "agent1");
    expect(result.renewed).toBe(true);
    expect(result.reactivated).toBe(true);

    // Profile should be active again
    const profile = await db.execute({
      sql: "SELECT active FROM profiles WHERE id = 'p8'",
      args: [],
    });
    expect(profile.rows[0]!.active).toBe(1);
  });

  it("renewListing rejects wrong agent", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p9", "agent1", "offering", "dev", "{}", future],
    });

    const result = await renewListing(db, "p9", "other_agent");
    expect(result.renewed).toBe(false);
    expect(result.error).toContain("Not authorized");
  });

  it("renewListing returns error for non-existent profile", async () => {
    const result = await renewListing(db, "nonexistent", "agent1");
    expect(result.renewed).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("expireStaleListings skips profiles without expires_at", async () => {
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)",
      args: ["p10", "agent1", "offering", "dev", "{}"],
    });
    // Remove the backfilled expires_at
    await db.execute({ sql: "UPDATE profiles SET expires_at = NULL WHERE id = 'p10'", args: [] });

    const count = await expireStaleListings(db);
    expect(count).toBe(0);

    const result = await db.execute({
      sql: "SELECT active FROM profiles WHERE id = 'p10'",
      args: [],
    });
    expect(result.rows[0]!.active).toBe(1);
  });
});
