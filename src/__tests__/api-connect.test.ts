import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb } from "@/lib/db";
import { _resetRateLimitStore } from "@/lib/rate-limit";
import type Database from "better-sqlite3";
import { POST, DELETE } from "@/app/api/connect/route";
import { POST as keysPOST } from "@/app/api/keys/route";
import { NextRequest } from "next/server";

let db: Database.Database;
let restore: () => void;

beforeEach(() => {
  _resetRateLimitStore();
  db = createTestDb();
  restore = _setDb(db);
});

afterEach(() => {
  restore();
  db.close();
});

async function getApiKey(agentId: string): Promise<string> {
  const req = new NextRequest("http://localhost:3000/api/keys", {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
    headers: { "Content-Type": "application/json" },
  });
  const res = await keysPOST(req);
  const data = await res.json();
  return data.api_key;
}

function makeRequest(method: string, body?: unknown, query?: string, apiKey?: string): NextRequest {
  const url = `http://localhost:3000/api/connect${query ? `?${query}` : ""}`;
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers,
  });
}

describe("POST /api/connect", () => {
  const validBody = {
    agent_id: "test-agent",
    side: "offering",
    category: "dev",
    params: { skills: ["react"] },
    description: "Test profile",
  };

  it("creates a profile and returns profile_id", async () => {
    const key = await getApiKey("test-agent");
    const res = await POST(makeRequest("POST", validBody, undefined, key));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.profile_id).toBeTruthy();
    expect(typeof data.profile_id).toBe("string");
  });

  it("stores the profile in the database", async () => {
    const key = await getApiKey("test-agent");
    const res = await POST(makeRequest("POST", validBody, undefined, key));
    const data = await res.json();

    const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(data.profile_id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.agent_id).toBe("test-agent");
    expect(row.side).toBe("offering");
    expect(row.category).toBe("dev");
    expect(JSON.parse(row.params as string)).toEqual({ skills: ["react"] });
    expect(row.active).toBe(1);
  });

  it("replaces existing profile with same agent/side/category", async () => {
    const key = await getApiKey("test-agent");
    const res1 = await POST(makeRequest("POST", validBody, undefined, key));
    const data1 = await res1.json();

    const res2 = await POST(makeRequest("POST", { ...validBody, description: "Updated" }, undefined, key));
    const data2 = await res2.json();

    expect(data2.replaced_profile_id).toBe(data1.profile_id);

    // Old profile should be inactive
    const old = db.prepare("SELECT active FROM profiles WHERE id = ?").get(data1.profile_id) as { active: number };
    expect(old.active).toBe(0);

    // New profile should be active
    const newP = db.prepare("SELECT active FROM profiles WHERE id = ?").get(data2.profile_id) as { active: number };
    expect(newP.active).toBe(1);
  });

  it("rejects missing agent_id", async () => {
    const key = await getApiKey("test-agent");
    const { agent_id, ...body } = validBody;
    const res = await POST(makeRequest("POST", body, undefined, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("agent_id");
  });

  it("rejects invalid side", async () => {
    const key = await getApiKey("test-agent");
    const res = await POST(makeRequest("POST", { ...validBody, side: "freelancer" }, undefined, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("side");
  });

  it("rejects missing category", async () => {
    const key = await getApiKey("test-agent");
    const { category, ...body } = validBody;
    const res = await POST(makeRequest("POST", body, undefined, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("category");
  });

  it("rejects missing params", async () => {
    const key = await getApiKey("test-agent");
    const { params, ...body } = validBody;
    const res = await POST(makeRequest("POST", body, undefined, key));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("params");
  });

  it("rejects invalid JSON body", async () => {
    const key = await getApiKey("test-agent");
    const req = new NextRequest("http://localhost:3000/api/connect", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects request without auth", async () => {
    const res = await POST(makeRequest("POST", validBody));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/connect", () => {
  it("deactivates a profile by profile_id", async () => {
    const key = await getApiKey("agent-x");
    const res = await POST(makeRequest("POST", {
      agent_id: "agent-x",
      side: "offering",
      category: "dev",
      params: { skills: ["react"] },
    }, undefined, key));
    const { profile_id } = await res.json();

    const delRes = await DELETE(makeRequest("DELETE", undefined, `profile_id=${profile_id}`, key));
    const data = await delRes.json();
    expect(delRes.status).toBe(200);
    expect(data.deactivated).toBe(profile_id);

    const row = db.prepare("SELECT active FROM profiles WHERE id = ?").get(profile_id) as { active: number };
    expect(row.active).toBe(0);
  });

  it("deactivates all profiles for an agent_id", async () => {
    const key = await getApiKey("agent-x");
    await POST(makeRequest("POST", {
      agent_id: "agent-x", side: "offering", category: "dev", params: {},
    }, undefined, key));
    await POST(makeRequest("POST", {
      agent_id: "agent-x", side: "seeking", category: "design", params: {},
    }, undefined, key));

    const delRes = await DELETE(makeRequest("DELETE", undefined, "agent_id=agent-x", key));
    const data = await delRes.json();
    expect(data.deactivated_count).toBe(2);
  });

  it("returns 404 for non-existent profile_id", async () => {
    const key = await getApiKey("agent-x");
    const res = await DELETE(makeRequest("DELETE", undefined, "profile_id=nonexistent", key));
    expect(res.status).toBe(404);
  });

  it("returns 400 when no identifier provided", async () => {
    const key = await getApiKey("agent-x");
    const res = await DELETE(makeRequest("DELETE", undefined, undefined, key));
    expect(res.status).toBe(400);
  });

  it("rejects request without auth", async () => {
    const res = await DELETE(makeRequest("DELETE", undefined, "agent_id=agent-x"));
    expect(res.status).toBe(401);
  });
});
