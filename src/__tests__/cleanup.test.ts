import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupExpiredDeals, cleanupInactiveProfiles } from "@/lib/cleanup";
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
  createdAt?: string
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, '{}', ?)",
    args: [id, agentId, side, category, createdAt ?? new Date().toISOString().replace("T", " ").slice(0, 19)],
  });
  return id;
}

async function insertMatch(
  profileAId: string,
  profileBId: string,
  status: string,
  expiresAt: string
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, expires_at) VALUES (?, ?, ?, '{}', ?, ?)",
    args: [id, profileAId, profileBId, status, expiresAt],
  });
  return id;
}

function pastDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
}

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
    .toISOString().replace("T", " ").slice(0, 19);
}

describe("cleanupExpiredDeals", () => {
  it("expires matched deals past their expiry date", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    await insertMatch(pA, pB, "matched", pastDate(1));

    const count = await cleanupExpiredDeals();
    expect(count).toBe(1);

    const result = await db.execute("SELECT status FROM matches");
    expect(result.rows[0].status).toBe("expired");
  });

  it("expires negotiating deals past their expiry date", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    await insertMatch(pA, pB, "negotiating", pastDate(1));

    const count = await cleanupExpiredDeals();
    expect(count).toBe(1);
  });

  it("does NOT expire approved deals", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    await insertMatch(pA, pB, "approved", pastDate(1));

    const count = await cleanupExpiredDeals();
    expect(count).toBe(0);

    const result = await db.execute("SELECT status FROM matches");
    expect(result.rows[0].status).toBe("approved");
  });

  it("does NOT expire rejected deals", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    await insertMatch(pA, pB, "rejected", pastDate(1));

    const count = await cleanupExpiredDeals();
    expect(count).toBe(0);

    const result = await db.execute("SELECT status FROM matches");
    expect(result.rows[0].status).toBe("rejected");
  });

  it("does NOT expire deals that haven't reached their expiry", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    await insertMatch(pA, pB, "matched", futureDate(3));

    const count = await cleanupExpiredDeals();
    expect(count).toBe(0);

    const result = await db.execute("SELECT status FROM matches");
    expect(result.rows[0].status).toBe("matched");
  });

  it("handles multiple deals correctly", async () => {
    const pA = await insertProfile("alice", "offering", "dev");
    const pB = await insertProfile("bob", "seeking", "dev");
    const pC = await insertProfile("charlie", "seeking", "dev");

    await insertMatch(pA, pB, "matched", pastDate(1));       // should expire
    await insertMatch(pA, pC, "approved", pastDate(1));       // should NOT expire

    const count = await cleanupExpiredDeals();
    expect(count).toBe(1);
  });
});

describe("cleanupInactiveProfiles", () => {
  it("deactivates profiles with no activity past the threshold", async () => {
    await insertProfile("alice", "offering", "dev", pastDate(60));

    const count = await cleanupInactiveProfiles(30);
    expect(count).toBe(1);

    const result = await db.execute("SELECT active FROM profiles");
    expect(result.rows[0].active).toBe(0);
  });

  it("keeps recent profiles active", async () => {
    await insertProfile("alice", "offering", "dev"); // created now

    const count = await cleanupInactiveProfiles(30);
    expect(count).toBe(0);

    const result = await db.execute("SELECT active FROM profiles");
    expect(result.rows[0].active).toBe(1);
  });

  it("keeps profiles with recent match activity", async () => {
    const pA = await insertProfile("alice", "offering", "dev", pastDate(60));
    const pB = await insertProfile("bob", "seeking", "dev", pastDate(60));

    // Recent match activity
    await insertMatch(pA, pB, "matched", futureDate(7));

    const count = await cleanupInactiveProfiles(30);
    // Both profiles have recent match activity
    expect(count).toBe(0);
  });

  it("does not deactivate already-inactive profiles", async () => {
    const id = await insertProfile("alice", "offering", "dev", pastDate(60));
    await db.execute({
      sql: "UPDATE profiles SET active = 0 WHERE id = ?",
      args: [id],
    });

    const count = await cleanupInactiveProfiles(30);
    expect(count).toBe(0);
  });
});
