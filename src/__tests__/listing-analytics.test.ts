import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET, POST } from "@/app/api/profiles/[profileId]/analytics/route";
import { GET as GET_ALL } from "@/app/api/listings/analytics/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;

function makeReq(url: string, opts?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), opts as never);
}

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);

  // Create test agent
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    args: ["user1", "testuser", "hash"],
  });
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
    args: ["key1", "agent1", "user1", "testhash"],
  });

  // Create a listing
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)",
    args: ["p1", "agent1", "offering", "development", '{"skills":["React"]}', "React dev"],
  });

  return () => restore();
});

function authHeader(agentId: string): string {
  // We'll use the raw key lookup; for tests, insert a known hash
  return `Bearer lc_test_${agentId}`;
}

// Helper: directly insert events for testing
async function insertEvent(profileId: string, eventType: string, viewer?: string) {
  await db.execute({
    sql: "INSERT INTO listing_events (profile_id, event_type, viewer_agent_id) VALUES (?, ?, ?)",
    args: [profileId, eventType, viewer || null],
  });
}

describe("POST /api/profiles/:profileId/analytics", () => {
  it("records a view event", async () => {
    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics", {
      method: "POST",
      body: JSON.stringify({ event_type: "view", viewer_agent_id: "agent2" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify in DB
    const result = await db.execute("SELECT * FROM listing_events WHERE profile_id = 'p1'");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].event_type).toBe("view");
    expect(result.rows[0].viewer_agent_id).toBe("agent2");
  });

  it("rejects invalid event_type", async () => {
    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics", {
      method: "POST",
      body: JSON.stringify({ event_type: "invalid" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent profile", async () => {
    const req = makeReq("http://localhost:3000/api/profiles/nonexistent/analytics", {
      method: "POST",
      body: JSON.stringify({ event_type: "view" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ profileId: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("records match and inquiry events", async () => {
    for (const eventType of ["match", "inquiry"]) {
      const req = makeReq("http://localhost:3000/api/profiles/p1/analytics", {
        method: "POST",
        body: JSON.stringify({ event_type: eventType }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req, { params: Promise.resolve({ profileId: "p1" }) });
      expect(res.status).toBe(200);
    }
    const result = await db.execute(
      "SELECT COUNT(*) as count FROM listing_events WHERE profile_id = 'p1'",
    );
    expect(Number(result.rows[0].count)).toBe(2);
  });
});

describe("GET /api/profiles/:profileId/analytics", () => {
  it("returns 401 without auth", async () => {
    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics");
    const res = await GET(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(401);
  });

  it("returns analytics for own listing", async () => {
    // Insert some events
    await insertEvent("p1", "view", "agent2");
    await insertEvent("p1", "view", "agent3");
    await insertEvent("p1", "view", "agent2");
    await insertEvent("p1", "match");
    await insertEvent("p1", "inquiry", "agent2");

    // Auth: create a real api key for agent1
    const { generateApiKey } = await import("@/lib/auth");
    const { raw, hash } = generateApiKey();
    await db.execute({
      sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
      args: ["key2", "agent1", "user1", hash],
    });

    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const res = await GET(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile_id).toBe("p1");
    expect(body.totals.view).toBe(3);
    expect(body.totals.match).toBe(1);
    expect(body.totals.inquiry).toBe(1);
    expect(body.unique_viewers).toBe(2);
    expect(body.period_days).toBe(30);
  });

  it("returns 403 for another agent's listing", async () => {
    // Create agent2
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      args: ["user2", "testuser2", "hash"],
    });
    const { generateApiKey } = await import("@/lib/auth");
    const { raw, hash } = generateApiKey();
    await db.execute({
      sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
      args: ["key3", "agent2", "user2", hash],
    });

    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const res = await GET(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(403);
  });

  it("respects days parameter", async () => {
    await insertEvent("p1", "view");

    const { generateApiKey } = await import("@/lib/auth");
    const { raw, hash } = generateApiKey();
    await db.execute({
      sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
      args: ["key4", "agent1", "user1", hash],
    });

    const req = makeReq("http://localhost:3000/api/profiles/p1/analytics?days=7", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const res = await GET(req, { params: Promise.resolve({ profileId: "p1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period_days).toBe(7);
    expect(body.totals.view).toBe(1);
  });
});

describe("GET /api/listings/analytics", () => {
  it("returns 401 without auth", async () => {
    const req = makeReq("http://localhost:3000/api/listings/analytics");
    const res = await GET_ALL(req);
    expect(res.status).toBe(401);
  });

  it("returns analytics for all agent listings", async () => {
    // Create second listing
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)",
      args: ["p2", "agent1", "seeking", "design", "{}", "Need designer"],
    });

    await insertEvent("p1", "view", "agent2");
    await insertEvent("p1", "match");
    await insertEvent("p2", "view", "agent3");
    await insertEvent("p2", "inquiry", "agent3");

    const { generateApiKey } = await import("@/lib/auth");
    const { raw, hash } = generateApiKey();
    await db.execute({
      sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
      args: ["key5", "agent1", "user1", hash],
    });

    const req = makeReq("http://localhost:3000/api/listings/analytics", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const res = await GET_ALL(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.length).toBe(2);
    expect(body.totals.view).toBe(2);
    expect(body.totals.match).toBe(1);
    expect(body.totals.inquiry).toBe(1);

    const p1 = body.listings.find((l: { profile_id: string }) => l.profile_id === "p1");
    expect(p1.views).toBe(1);
    expect(p1.matches).toBe(1);

    const p2 = body.listings.find((l: { profile_id: string }) => l.profile_id === "p2");
    expect(p2.views).toBe(1);
    expect(p2.inquiries).toBe(1);
  });

  it("returns empty for agent with no listings", async () => {
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      args: ["user3", "testuser3", "hash"],
    });
    const { generateApiKey } = await import("@/lib/auth");
    const { raw, hash } = generateApiKey();
    await db.execute({
      sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
      args: ["key6", "nolistings", "user3", hash],
    });

    const req = makeReq("http://localhost:3000/api/listings/analytics", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    const res = await GET_ALL(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.length).toBe(0);
    expect(body.totals.view).toBe(0);
  });
});
