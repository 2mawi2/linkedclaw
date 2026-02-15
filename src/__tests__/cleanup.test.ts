import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupExpiredDeals, cleanupInactiveProfiles } from "@/lib/cleanup";
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
  createdAt?: string
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO profiles (id, agent_id, side, category, params, created_at) VALUES (?, ?, ?, ?, '{}', ?)"
  ).run(id, agentId, side, category, createdAt ?? new Date().toISOString().replace("T", " ").slice(0, 19));
  return id;
}

function insertMatch(
  profileAId: string,
  profileBId: string,
  status: string,
  expiresAt: string
): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, expires_at) VALUES (?, ?, ?, '{}', ?, ?)"
  ).run(id, profileAId, profileBId, status, expiresAt);
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
  it("expires matched deals past their expiry date", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    insertMatch(pA, pB, "matched", pastDate(1));

    const count = cleanupExpiredDeals();
    expect(count).toBe(1);

    const row = db.prepare("SELECT status FROM matches").get() as { status: string };
    expect(row.status).toBe("expired");
  });

  it("expires negotiating deals past their expiry date", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    insertMatch(pA, pB, "negotiating", pastDate(1));

    const count = cleanupExpiredDeals();
    expect(count).toBe(1);
  });

  it("does NOT expire approved deals", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    insertMatch(pA, pB, "approved", pastDate(1));

    const count = cleanupExpiredDeals();
    expect(count).toBe(0);

    const row = db.prepare("SELECT status FROM matches").get() as { status: string };
    expect(row.status).toBe("approved");
  });

  it("does NOT expire rejected deals", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    insertMatch(pA, pB, "rejected", pastDate(1));

    const count = cleanupExpiredDeals();
    expect(count).toBe(0);

    const row = db.prepare("SELECT status FROM matches").get() as { status: string };
    expect(row.status).toBe("rejected");
  });

  it("does NOT expire deals that haven't reached their expiry", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    insertMatch(pA, pB, "matched", futureDate(3));

    const count = cleanupExpiredDeals();
    expect(count).toBe(0);

    const row = db.prepare("SELECT status FROM matches").get() as { status: string };
    expect(row.status).toBe("matched");
  });

  it("handles multiple deals correctly", () => {
    const pA = insertProfile("alice", "offering", "dev");
    const pB = insertProfile("bob", "seeking", "dev");
    const pC = insertProfile("charlie", "seeking", "dev");

    insertMatch(pA, pB, "matched", pastDate(1));       // should expire
    insertMatch(pA, pC, "approved", pastDate(1));       // should NOT expire

    const count = cleanupExpiredDeals();
    expect(count).toBe(1);
  });
});

describe("cleanupInactiveProfiles", () => {
  it("deactivates profiles with no activity past the threshold", () => {
    insertProfile("alice", "offering", "dev", pastDate(60));

    const count = cleanupInactiveProfiles(30);
    expect(count).toBe(1);

    const row = db.prepare("SELECT active FROM profiles").get() as { active: number };
    expect(row.active).toBe(0);
  });

  it("keeps recent profiles active", () => {
    insertProfile("alice", "offering", "dev"); // created now

    const count = cleanupInactiveProfiles(30);
    expect(count).toBe(0);

    const row = db.prepare("SELECT active FROM profiles").get() as { active: number };
    expect(row.active).toBe(1);
  });

  it("keeps profiles with recent match activity", () => {
    const pA = insertProfile("alice", "offering", "dev", pastDate(60));
    const pB = insertProfile("bob", "seeking", "dev", pastDate(60));

    // Recent match activity
    insertMatch(pA, pB, "matched", futureDate(7));

    const count = cleanupInactiveProfiles(30);
    // Both profiles have recent match activity
    expect(count).toBe(0);
  });

  it("does not deactivate already-inactive profiles", () => {
    const id = insertProfile("alice", "offering", "dev", pastDate(60));
    db.prepare("UPDATE profiles SET active = 0 WHERE id = ?").run(id);

    const count = cleanupInactiveProfiles(30);
    expect(count).toBe(0);
  });
});
