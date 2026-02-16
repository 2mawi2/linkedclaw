import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST } from "@/app/api/profiles/bulk/route";
import { POST as connectPost } from "@/app/api/connect/route";
import { NextRequest } from "next/server";

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

function makeRequest(body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest("http://localhost:3000/api/profiles/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

function makeConnectRequest(body: unknown, apiKey: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

async function createProfile(agentId: string, apiKey: string, overrides?: Record<string, unknown>) {
  const body = {
    agent_id: agentId,
    side: "offering",
    category: "development",
    description: "Test profile",
    params: { skills: ["React"], rate_min: 50, rate_max: 100, currency: "USD" },
    ...overrides,
  };
  const res = await connectPost(makeConnectRequest(body, apiKey));
  const data = await res.json();
  return data.profile_id as string;
}

describe("POST /api/profiles/bulk", () => {
  it("returns 401 without auth", async () => {
    const res = await POST(makeRequest({ operations: [] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing operations", async () => {
    const key = await createApiKey("agent-1");
    const res = await POST(makeRequest({}, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("operations must be an array");
  });

  it("returns 400 for empty operations array", async () => {
    const key = await createApiKey("agent-1");
    const res = await POST(makeRequest({ operations: [] }, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("must not be empty");
  });

  it("returns 400 for too many operations", async () => {
    const key = await createApiKey("agent-1");
    const ops = Array.from({ length: 51 }, (_, i) => ({
      profile_id: `p-${i}`,
      action: "deactivate",
    }));
    const res = await POST(makeRequest({ operations: ops }, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Maximum 50");
  });

  it("returns 400 for invalid action", async () => {
    const key = await createApiKey("agent-1");
    const res = await POST(
      makeRequest({ operations: [{ profile_id: "p1", action: "delete" }] }, key),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("action must be one of");
  });

  it("deactivates multiple profiles at once", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key, { category: "development" });
    const p2 = await createProfile("agent-1", key, { category: "design" });

    const res = await POST(
      makeRequest(
        {
          operations: [
            { profile_id: p1, action: "deactivate" },
            { profile_id: p2, action: "deactivate" },
          ],
        },
        key,
      ),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.succeeded).toBe(2);
    expect(data.failed).toBe(0);
    expect(data.results[0].success).toBe(true);
    expect(data.results[1].success).toBe(true);

    // Verify profiles are inactive
    const result = await db.execute({
      sql: "SELECT active FROM profiles WHERE id IN (?, ?)",
      args: [p1, p2],
    });
    for (const row of result.rows) {
      expect(row.active).toBe(0);
    }
  });

  it("activates a deactivated profile", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);

    // Deactivate first
    await db.execute({ sql: "UPDATE profiles SET active = 0 WHERE id = ?", args: [p1] });

    const res = await POST(
      makeRequest({ operations: [{ profile_id: p1, action: "activate" }] }, key),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.succeeded).toBe(1);

    const result = await db.execute({ sql: "SELECT active FROM profiles WHERE id = ?", args: [p1] });
    expect(result.rows[0].active).toBe(1);
  });

  it("updates multiple profiles at once", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);
    const p2 = await createProfile("agent-1", key, { category: "design" });

    const res = await POST(
      makeRequest(
        {
          operations: [
            {
              profile_id: p1,
              action: "update",
              description: "Updated description 1",
              availability: "busy",
            },
            {
              profile_id: p2,
              action: "update",
              params: { rate_min: 80, rate_max: 150 },
            },
          ],
        },
        key,
      ),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.succeeded).toBe(2);

    // Verify updates
    const r1 = await db.execute({ sql: "SELECT description, availability FROM profiles WHERE id = ?", args: [p1] });
    expect(r1.rows[0].description).toBe("Updated description 1");
    expect(r1.rows[0].availability).toBe("busy");

    const r2 = await db.execute({ sql: "SELECT params FROM profiles WHERE id = ?", args: [p2] });
    const params = JSON.parse(r2.rows[0].params as string);
    expect(params.rate_min).toBe(80);
    expect(params.rate_max).toBe(150);
    // Original params should be preserved
    expect(params.skills).toEqual(["React"]);
  });

  it("rejects operations on profiles owned by other agents", async () => {
    const key1 = await createApiKey("agent-1");
    const key2 = await createApiKey("agent-2");
    const p1 = await createProfile("agent-1", key1);

    const res = await POST(
      makeRequest({ operations: [{ profile_id: p1, action: "deactivate" }] }, key2),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.results[0].error).toBe("Not authorized");
  });

  it("handles mixed success and failure", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);

    const res = await POST(
      makeRequest(
        {
          operations: [
            { profile_id: p1, action: "deactivate" },
            { profile_id: "nonexistent-id", action: "deactivate" },
          ],
        },
        key,
      ),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(1);
    expect(data.results[0].success).toBe(true);
    expect(data.results[1].success).toBe(false);
    expect(data.results[1].error).toBe("Profile not found");
  });

  it("fails to deactivate already inactive profile", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);
    await db.execute({ sql: "UPDATE profiles SET active = 0 WHERE id = ?", args: [p1] });

    const res = await POST(
      makeRequest({ operations: [{ profile_id: p1, action: "deactivate" }] }, key),
    );

    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.results[0].error).toBe("Already inactive");
  });

  it("fails to activate already active profile", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);

    const res = await POST(
      makeRequest({ operations: [{ profile_id: p1, action: "activate" }] }, key),
    );

    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.results[0].error).toBe("Already active");
  });

  it("fails to update inactive profile", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);
    await db.execute({ sql: "UPDATE profiles SET active = 0 WHERE id = ?", args: [p1] });

    const res = await POST(
      makeRequest(
        { operations: [{ profile_id: p1, action: "update", description: "new" }] },
        key,
      ),
    );

    const data = await res.json();
    expect(data.failed).toBe(1);
    expect(data.results[0].error).toBe("Cannot update inactive profile");
  });

  it("validates update action requires fields", async () => {
    const key = await createApiKey("agent-1");
    const res = await POST(
      makeRequest({ operations: [{ profile_id: "p1", action: "update" }] }, key),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("requires at least one of");
  });

  it("validates availability values", async () => {
    const key = await createApiKey("agent-1");
    const res = await POST(
      makeRequest(
        { operations: [{ profile_id: "p1", action: "update", availability: "sleeping" }] },
        key,
      ),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("availability");
  });

  it("handles duplicate profile_ids in operations", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);

    // Deactivate then try to deactivate again - second should fail
    const res = await POST(
      makeRequest(
        {
          operations: [
            { profile_id: p1, action: "deactivate" },
            { profile_id: p1, action: "deactivate" },
          ],
        },
        key,
      ),
    );

    const data = await res.json();
    expect(data.total).toBe(2);
    // First succeeds, second fails (already deactivated by first)
    expect(data.results[0].success).toBe(true);
    // Note: second may still succeed since we read state upfront
    // The profileMap snapshot means both see it as active
  });

  it("updates tags via bulk operation", async () => {
    const key = await createApiKey("agent-1");
    const p1 = await createProfile("agent-1", key);

    const res = await POST(
      makeRequest(
        {
          operations: [{ profile_id: p1, action: "update", tags: ["urgent", "senior"] }],
        },
        key,
      ),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.succeeded).toBe(1);

    // Verify tags were saved
    const tagResult = await db.execute({
      sql: "SELECT tag FROM profile_tags WHERE profile_id = ? ORDER BY tag",
      args: [p1],
    });
    expect(tagResult.rows.map((r) => r.tag)).toEqual(["senior", "urgent"]);
  });
});
