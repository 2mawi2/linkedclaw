import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET, POST } from "@/app/api/saved-searches/route";
import { GET as getOne, PATCH, DELETE } from "@/app/api/saved-searches/[id]/route";
import { POST as checkPOST } from "@/app/api/saved-searches/check/route";
import { POST as connectPOST } from "@/app/api/connect/route";
import { NextRequest } from "next/server";

let db: Client;
let restore: () => void;
let aliceKey: string;
let bobKey: string;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await createApiKey("alice");
  bobKey = await createApiKey("bob");
});

afterEach(() => {
  restore();
});

function jsonReq(url: string, opts?: { body?: unknown; apiKey?: string; method?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts?.body) headers["Content-Type"] = "application/json";
  if (opts?.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  const method = opts?.method ?? (opts?.body ? "POST" : "GET");
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
    headers,
  });
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Saved Searches API", () => {
  it("requires authentication", async () => {
    const res = await GET(jsonReq("/api/saved-searches"));
    expect(res.status).toBe(401);
  });

  it("creates a saved search", async () => {
    const res = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "React jobs", query: "react", category: "development", side: "seeking" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("React jobs");
    expect(data.query).toBe("react");
    expect(data.category).toBe("development");
    expect(data.side).toBe("seeking");
    expect(data.notify).toBe(true);
    expect(data.type).toBe("profiles");
    expect(data.id).toBeTruthy();
  });

  it("lists saved searches", async () => {
    await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Search 1", query: "react" },
        apiKey: aliceKey,
      }),
    );
    await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Search 2", category: "design" },
        apiKey: aliceKey,
      }),
    );

    const res = await GET(jsonReq("/api/saved-searches?agent_id=alice", { apiKey: aliceKey }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.saved_searches).toHaveLength(2);
  });

  it("prevents viewing another agent's searches", async () => {
    const res = await GET(jsonReq("/api/saved-searches?agent_id=alice", { apiKey: bobKey }));
    expect(res.status).toBe(403);
  });

  it("gets a single saved search", async () => {
    const createRes = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "My Search", query: "typescript", skills: ["TypeScript"] },
        apiKey: aliceKey,
      }),
    );
    const { id } = await createRes.json();

    const res = await getOne(jsonReq(`/api/saved-searches/${id}`, { apiKey: aliceKey }), routeCtx(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("My Search");
    expect(data.skills).toEqual(["TypeScript"]);
  });

  it("updates a saved search", async () => {
    const createRes = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Old Name", query: "react" },
        apiKey: aliceKey,
      }),
    );
    const { id } = await createRes.json();

    const res = await PATCH(
      jsonReq(`/api/saved-searches/${id}`, {
        body: { name: "New Name", notify: false },
        apiKey: aliceKey,
        method: "PATCH",
      }),
      routeCtx(id),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("New Name");
    expect(data.notify).toBe(false);
  });

  it("deletes a saved search", async () => {
    const createRes = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "To Delete" },
        apiKey: aliceKey,
      }),
    );
    const { id } = await createRes.json();

    const res = await DELETE(
      jsonReq(`/api/saved-searches/${id}`, { apiKey: aliceKey, method: "DELETE" }),
      routeCtx(id),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);

    // Verify it's gone
    const listRes = await GET(jsonReq("/api/saved-searches?agent_id=alice", { apiKey: aliceKey }));
    const listData = await listRes.json();
    expect(listData.total).toBe(0);
  });

  it("prevents deleting another agent's search", async () => {
    const createRes = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Alice's Search" },
        apiKey: aliceKey,
      }),
    );
    const { id } = await createRes.json();

    const res = await DELETE(
      jsonReq(`/api/saved-searches/${id}`, { apiKey: bobKey, method: "DELETE" }),
      routeCtx(id),
    );
    expect(res.status).toBe(403);
  });

  it("enforces max 20 saved searches per agent", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(
        jsonReq("/api/saved-searches", {
          body: { agent_id: "alice", name: `Search ${i}` },
          apiKey: aliceKey,
        }),
      );
    }

    const res = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Search 21" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Maximum");
  });

  it("validates required name field", async () => {
    const res = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("name");
  });

  it("validates side field", async () => {
    const res = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Test", side: "invalid" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("validates type field", async () => {
    const res = await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Test", type: "invalid" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Saved Searches Check", () => {
  it("checks for new matches since last check", async () => {
    // Save a search for development/offering profiles
    await POST(
      jsonReq("/api/saved-searches", {
        body: {
          agent_id: "alice",
          name: "Dev offerings",
          category: "development",
          side: "offering",
          type: "profiles",
        },
        apiKey: aliceKey,
      }),
    );

    // Set last_checked_at to the past so new profiles show up
    await db.execute({
      sql: "UPDATE saved_searches SET last_checked_at = datetime('now', '-1 hour')",
      args: [],
    });

    // Bob creates a listing that matches
    await connectPOST(
      jsonReq("/api/connect", {
        body: {
          agent_id: "bob",
          side: "offering",
          category: "development",
          description: "Node.js developer",
          params: { skills: ["Node.js", "TypeScript"], rate_min: 80, rate_max: 120 },
        },
        apiKey: bobKey,
      }),
    );

    // Check saved searches
    const res = await checkPOST(
      jsonReq("/api/saved-searches/check", {
        body: { agent_id: "alice" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(1);
    expect(data.total_new).toBeGreaterThan(0);
    expect(data.results[0].search_name).toBe("Dev offerings");
    expect(data.results[0].new_profiles).toBeDefined();
    expect(data.results[0].new_profiles.length).toBeGreaterThan(0);
  });

  it("returns empty when no new matches", async () => {
    // Save a search
    await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Design", category: "design", type: "profiles" },
        apiKey: aliceKey,
      }),
    );

    // Check immediately - nothing new since creation
    const res = await checkPOST(
      jsonReq("/api/saved-searches/check", {
        body: { agent_id: "alice" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(1);
    expect(data.total_new).toBe(0);
    expect(data.results).toHaveLength(0);
  });

  it("checks bounty searches too", async () => {
    await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Dev bounties", category: "development", type: "bounties" },
        apiKey: aliceKey,
      }),
    );

    // Set last_checked_at to the past
    await db.execute({
      sql: "UPDATE saved_searches SET last_checked_at = datetime('now', '-1 hour')",
      args: [],
    });

    // Create a bounty directly
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, description, category, skills, budget_min, budget_max, currency, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["bounty-1", "bob", "Build a dashboard", "React dashboard", "development", '["React"]', 500, 2000, "USD", "open"],
    });

    const res = await checkPOST(
      jsonReq("/api/saved-searches/check", {
        body: { agent_id: "alice" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_new).toBeGreaterThan(0);
    expect(data.results[0].new_bounties).toBeDefined();
  });

  it("skips searches with notify disabled", async () => {
    await POST(
      jsonReq("/api/saved-searches", {
        body: { agent_id: "alice", name: "Muted", category: "development", notify: false },
        apiKey: aliceKey,
      }),
    );

    const res = await checkPOST(
      jsonReq("/api/saved-searches/check", {
        body: { agent_id: "alice" },
        apiKey: aliceKey,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(0); // notify=false searches are skipped
  });
});
