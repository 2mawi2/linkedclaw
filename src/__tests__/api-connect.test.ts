import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb } from "@/lib/db";
import type Database from "better-sqlite3";
import { POST, DELETE } from "@/app/api/connect/route";
import { NextRequest } from "next/server";

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

function makeRequest(method: string, body?: unknown, query?: string): NextRequest {
  const url = `http://localhost:3000/api/connect${query ? `?${query}` : ""}`;
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
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
    const res = await POST(makeRequest("POST", validBody));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.profile_id).toBeTruthy();
    expect(typeof data.profile_id).toBe("string");
  });

  it("stores the profile in the database", async () => {
    const res = await POST(makeRequest("POST", validBody));
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
    const res1 = await POST(makeRequest("POST", validBody));
    const data1 = await res1.json();

    const res2 = await POST(makeRequest("POST", { ...validBody, description: "Updated" }));
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
    const { agent_id, ...body } = validBody;
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("agent_id");
  });

  it("rejects invalid side", async () => {
    const res = await POST(makeRequest("POST", { ...validBody, side: "freelancer" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("side");
  });

  it("rejects missing category", async () => {
    const { category, ...body } = validBody;
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("category");
  });

  it("rejects missing params", async () => {
    const { params, ...body } = validBody;
    const res = await POST(makeRequest("POST", body));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("params");
  });

  it("rejects invalid JSON body", async () => {
    const req = new NextRequest("http://localhost:3000/api/connect", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/connect", () => {
  it("deactivates a profile by profile_id", async () => {
    const res = await POST(makeRequest("POST", {
      agent_id: "agent-x",
      side: "offering",
      category: "dev",
      params: { skills: ["react"] },
    }));
    const { profile_id } = await res.json();

    const delRes = await DELETE(makeRequest("DELETE", undefined, `profile_id=${profile_id}`));
    const data = await delRes.json();
    expect(delRes.status).toBe(200);
    expect(data.deactivated).toBe(profile_id);

    const row = db.prepare("SELECT active FROM profiles WHERE id = ?").get(profile_id) as { active: number };
    expect(row.active).toBe(0);
  });

  it("deactivates all profiles for an agent_id", async () => {
    await POST(makeRequest("POST", {
      agent_id: "agent-x", side: "offering", category: "dev", params: {},
    }));
    await POST(makeRequest("POST", {
      agent_id: "agent-x", side: "seeking", category: "design", params: {},
    }));

    const delRes = await DELETE(makeRequest("DELETE", undefined, "agent_id=agent-x"));
    const data = await delRes.json();
    expect(data.deactivated_count).toBe(2);
  });

  it("returns 404 for non-existent profile_id", async () => {
    const res = await DELETE(makeRequest("DELETE", undefined, "profile_id=nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when no identifier provided", async () => {
    const res = await DELETE(makeRequest("DELETE"));
    expect(res.status).toBe(400);
  });
});
