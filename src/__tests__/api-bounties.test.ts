import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET, POST } from "@/app/api/bounties/route";
import { GET as GET_ONE, PATCH } from "@/app/api/bounties/[id]/route";
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

function makeRequest(method: string, url: string, body?: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

const validBounty = {
  agent_id: "test-agent",
  title: "Build a React dashboard",
  description: "Need a full dashboard with charts and tables",
  category: "development",
  skills: ["React", "TypeScript", "D3"],
  budget_min: 500,
  budget_max: 2000,
  currency: "EUR",
  deadline: "2026-03-01",
};

describe("POST /api/bounties", () => {
  it("creates a bounty with valid data", async () => {
    const key = await createApiKey("test-agent");
    const res = await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.title).toBe("Build a React dashboard");
    expect(data.category).toBe("development");
    expect(data.status).toBe("open");
  });

  it("rejects without auth", async () => {
    const res = await POST(makeRequest("POST", "/api/bounties", validBounty));
    expect(res.status).toBe(401);
  });

  it("rejects missing title", async () => {
    const key = await createApiKey("test-agent");
    const body = { ...validBounty, title: "" };
    const res = await POST(makeRequest("POST", "/api/bounties", body, key));
    expect(res.status).toBe(400);
  });

  it("rejects missing category", async () => {
    const key = await createApiKey("test-agent");
    const body = { ...validBounty, category: "" };
    const res = await POST(makeRequest("POST", "/api/bounties", body, key));
    expect(res.status).toBe(400);
  });

  it("rejects missing agent_id", async () => {
    const key = await createApiKey("test-agent");
    const body = { ...validBounty, agent_id: undefined };
    const res = await POST(makeRequest("POST", "/api/bounties", body, key));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/bounties", () => {
  it("returns empty list when no bounties", async () => {
    const res = await GET(makeRequest("GET", "/api/bounties"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(0);
    expect(data.bounties).toEqual([]);
  });

  it("returns created bounties", async () => {
    const key = await createApiKey("test-agent");
    await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    await POST(
      makeRequest(
        "POST",
        "/api/bounties",
        { ...validBounty, title: "Second bounty" },
        key,
      ),
    );

    const res = await GET(makeRequest("GET", "/api/bounties"));
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.bounties).toHaveLength(2);
  });

  it("filters by category", async () => {
    const key = await createApiKey("test-agent");
    await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    await POST(
      makeRequest(
        "POST",
        "/api/bounties",
        { ...validBounty, title: "Design work", category: "design" },
        key,
      ),
    );

    const res = await GET(makeRequest("GET", "/api/bounties?category=development"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].category).toBe("development");
  });

  it("filters by search query", async () => {
    const key = await createApiKey("test-agent");
    await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    await POST(
      makeRequest(
        "POST",
        "/api/bounties",
        { ...validBounty, title: "Python ML pipeline", description: "Build a data pipeline", skills: ["Python", "TensorFlow"] },
        key,
      ),
    );

    const res = await GET(makeRequest("GET", "/api/bounties?q=pipeline"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.bounties[0].title).toContain("pipeline");
  });

  it("returns parsed skills array", async () => {
    const key = await createApiKey("test-agent");
    await POST(makeRequest("POST", "/api/bounties", validBounty, key));

    const res = await GET(makeRequest("GET", "/api/bounties"));
    const data = await res.json();
    expect(data.bounties[0].skills).toEqual(["React", "TypeScript", "D3"]);
  });
});

describe("GET /api/bounties/:id", () => {
  it("returns a single bounty", async () => {
    const key = await createApiKey("test-agent");
    const createRes = await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    const created = await createRes.json();

    const res = await GET_ONE(
      makeRequest("GET", `/api/bounties/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Build a React dashboard");
    expect(data.skills).toEqual(["React", "TypeScript", "D3"]);
    expect(data.budget_min).toBe(500);
    expect(data.budget_max).toBe(2000);
  });

  it("returns 404 for non-existent bounty", async () => {
    const res = await GET_ONE(
      makeRequest("GET", "/api/bounties/nonexistent"),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/bounties/:id", () => {
  it("updates bounty status", async () => {
    const key = await createApiKey("test-agent");
    const createRes = await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    const created = await createRes.json();

    const res = await PATCH(
      makeRequest("PATCH", `/api/bounties/${created.id}`, { agent_id: "test-agent", status: "cancelled" }, key),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);

    // Verify status changed
    const getRes = await GET_ONE(
      makeRequest("GET", `/api/bounties/${created.id}`),
      { params: Promise.resolve({ id: created.id }) },
    );
    const data = await getRes.json();
    expect(data.status).toBe("cancelled");
  });

  it("rejects update from non-owner", async () => {
    const key = await createApiKey("test-agent");
    const otherKey = await createApiKey("other-agent");
    const createRes = await POST(makeRequest("POST", "/api/bounties", validBounty, key));
    const created = await createRes.json();

    const res = await PATCH(
      makeRequest("PATCH", `/api/bounties/${created.id}`, { agent_id: "other-agent", status: "cancelled" }, otherKey),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("rejects without auth", async () => {
    const res = await PATCH(
      makeRequest("PATCH", "/api/bounties/some-id", { agent_id: "test", status: "cancelled" }),
      { params: Promise.resolve({ id: "some-id" }) },
    );
    expect(res.status).toBe(401);
  });
});
