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

  it("purges e2e and maintenance test accounts by pattern", async () => {
    await seedTestUser("e2e-dev-12345");
    await seedTestUser("e2e-client-12345");
    await seedTestUser("maint-test-a-99");
    await seedTestUser("mfix-b-100");
    await seedTestUser("devcheck-200");
    await seedTestUser("flowtest-300");
    await seedTestUser("dbg-a-400");
    await seedTestUser("real-agent");

    const res = await POST(makeReq(undefined, ADMIN_SECRET));
    const data = await res.json();

    expect(data.purged).toContain("e2e-dev-12345");
    expect(data.purged).toContain("e2e-client-12345");
    expect(data.purged).toContain("maint-test-a-99");
    expect(data.purged).toContain("mfix-b-100");
    expect(data.purged).toContain("devcheck-200");
    expect(data.purged).toContain("flowtest-300");
    expect(data.purged).toContain("dbg-a-400");
    expect(data.purged).not.toContain("real-agent");
  });

  it("purges cron-test and maint-* accounts by pattern", async () => {
    await seedTestUser("cron-test-1771193729");
    await seedTestUser("maint-dbg-1771189195");
    await seedTestUser("maint-e2e-a-1771189078");
    await seedTestUser("maint-inbox-1771189114");
    await seedTestUser("maint-notif-a-1771189180");
    await seedTestUser("notif-dev");
    await seedTestUser("real-agent");

    const res = await POST(makeReq(undefined, ADMIN_SECRET));
    const data = await res.json();

    expect(data.purged).toContain("cron-test-1771193729");
    expect(data.purged).toContain("maint-dbg-1771189195");
    expect(data.purged).toContain("maint-e2e-a-1771189078");
    expect(data.purged).toContain("maint-inbox-1771189114");
    expect(data.purged).toContain("maint-notif-a-1771189180");
    expect(data.purged).toContain("notif-dev");
    expect(data.purged).not.toContain("real-agent");
  });

  it("returns empty array when no matches", async () => {
    await seedTestUser("real-agent");
    const res = await POST(makeReq(undefined, ADMIN_SECRET));
    const data = await res.json();
    expect(data.purged).toEqual([]);
  });
});
