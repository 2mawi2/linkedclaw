import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, migrate, _setDb } from "@/lib/db";
import { POST } from "@/app/api/admin/purge/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";

let db: Client;
let restore: () => void;
const ADMIN_SECRET = "test-admin-secret-123";

function makeReq(body?: object, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/admin/purge", {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seedTestUser(username: string) {
  const userId = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    args: [userId, username, "hash"],
  });
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
    args: [crypto.randomUUID(), username, userId, crypto.randomUUID()],
  });
  const profileId = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'offering', 'dev', '{}')",
    args: [profileId, username],
  });
  return { userId, profileId };
}

describe("Admin Purge", () => {
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

  it("returns 503 when ADMIN_SECRET is not set", async () => {
    delete process.env.ADMIN_SECRET;
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
  });

  it("returns 401 with wrong token", async () => {
    const res = await POST(makeReq({}, "wrong-token"));
    expect(res.status).toBe(401);
  });

  it("purges test accounts by pattern", async () => {
    await seedTestUser("testbot123");
    await seedTestUser("testlob456");
    await seedTestUser("real-agent");

    const res = await POST(makeReq(undefined, ADMIN_SECRET));
    const data = await res.json();

    expect(data.purged).toContain("testbot123");
    expect(data.purged).toContain("testlob456");
    expect(data.purged).not.toContain("real-agent");

    // Verify test user is gone
    const users = await db.execute("SELECT username FROM users");
    expect(users.rows.map((r) => r.username)).toEqual(["real-agent"]);
  });

  it("purges specific usernames when provided", async () => {
    await seedTestUser("real-agent");
    await seedTestUser("another-agent");

    const res = await POST(makeReq({ usernames: ["real-agent"] }, ADMIN_SECRET));
    const data = await res.json();

    expect(data.purged).toEqual(["real-agent"]);

    const users = await db.execute("SELECT username FROM users");
    expect(users.rows.map((r) => r.username)).toEqual(["another-agent"]);
  });

  it("returns empty array when no matches", async () => {
    await seedTestUser("real-agent");
    const res = await POST(makeReq(undefined, ADMIN_SECRET));
    const data = await res.json();
    expect(data.purged).toEqual([]);
  });
});
