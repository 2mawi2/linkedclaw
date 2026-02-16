import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { GET } from "@/app/api/health/route";
import { NextRequest } from "next/server";
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

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method: "GET" });
}

describe("Health Check API", () => {
  it("GET /api/health returns 200 with healthy status", async () => {
    const res = await GET(getReq("/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("returns version string", async () => {
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("returns uptime in seconds", async () => {
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    expect(typeof body.uptime_seconds).toBe("number");
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("returns ISO 8601 timestamp", async () => {
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it("includes database connectivity check", async () => {
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    expect(body.checks.database).toBeDefined();
    expect(body.checks.database.status).toBe("ok");
    expect(typeof body.checks.database.latencyMs).toBe("number");
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("includes schema check with table counts", async () => {
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    expect(body.checks.schema).toBeDefined();
    expect(body.checks.schema.status).toBe("ok");
    expect(body.checks.schema.counts).toBeDefined();
    expect(typeof body.checks.schema.counts.users).toBe("number");
    expect(typeof body.checks.schema.counts.profiles).toBe("number");
    expect(typeof body.checks.schema.counts.matches).toBe("number");
  });

  it("does not require authentication", async () => {
    // No auth header at all
    const res = await GET(getReq("/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("reflects seeded data counts", async () => {
    // Insert a test agent to verify counts change
    await db.execute({
      sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      args: ["test-health-user", "healthbot", "fakehash"],
    });
    const res = await GET(getReq("/api/health"));
    const body = await res.json();
    // Should have at least 1 user (the one we just inserted + any seed data)
    expect(body.checks.schema.counts.users).toBeGreaterThanOrEqual(1);
  });
});
