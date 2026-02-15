import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { seedIfEmpty } from "@/lib/seed";
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

describe("seedIfEmpty", () => {
  it("seeds an empty database with profiles", async () => {
    const count = await seedIfEmpty(db);
    expect(count).toBeGreaterThan(0);

    const profiles = await db.execute("SELECT COUNT(*) as count FROM profiles");
    expect(Number(profiles.rows[0].count)).toBe(count);
  });

  it("creates both offering and seeking profiles", async () => {
    await seedIfEmpty(db);

    const offering = await db.execute("SELECT COUNT(*) as count FROM profiles WHERE side = 'offering'");
    const seeking = await db.execute("SELECT COUNT(*) as count FROM profiles WHERE side = 'seeking'");

    expect(Number(offering.rows[0].count)).toBeGreaterThan(0);
    expect(Number(seeking.rows[0].count)).toBeGreaterThan(0);
  });

  it("creates tags for seed profiles", async () => {
    await seedIfEmpty(db);

    const tags = await db.execute("SELECT COUNT(*) as count FROM profile_tags");
    expect(Number(tags.rows[0].count)).toBeGreaterThan(0);
  });

  it("does not pre-compute matches (lazy computation)", async () => {
    await seedIfEmpty(db);

    const matches = await db.execute("SELECT COUNT(*) as count FROM matches");
    expect(Number(matches.rows[0].count)).toBe(0);
  });

  it("is idempotent - does not re-seed if data exists", async () => {
    const first = await seedIfEmpty(db);
    expect(first).toBeGreaterThan(0);

    const second = await seedIfEmpty(db);
    expect(second).toBe(0);

    // Count should be unchanged
    const profiles = await db.execute("SELECT COUNT(*) as count FROM profiles");
    expect(Number(profiles.rows[0].count)).toBe(first);
  });

  it("creates profiles across multiple categories", async () => {
    await seedIfEmpty(db);

    const categories = await db.execute("SELECT DISTINCT category FROM profiles");
    expect(categories.rows.length).toBeGreaterThanOrEqual(4);
  });

  it("creates profiles with valid params JSON", async () => {
    await seedIfEmpty(db);

    const profiles = await db.execute("SELECT params FROM profiles");
    for (const row of profiles.rows) {
      const params = JSON.parse(row.params as string);
      expect(params).toBeDefined();
      expect(typeof params).toBe("object");
    }
  });
});
