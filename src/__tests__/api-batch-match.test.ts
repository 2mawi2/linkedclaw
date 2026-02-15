import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { GET } from "@/app/api/matches/batch/route";
import { NextRequest } from "next/server";
import type { Client } from "@libsql/client";

let db: Client;
let restore: () => void;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  restore = _setDb(db);
});

afterEach(() => {
  restore();
});

async function registerKey(agentId: string): Promise<string> {
  const { raw, hash } = generateApiKey();
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [crypto.randomUUID(), agentId, hash],
  });
  return raw;
}

async function createProfile(
  agentId: string,
  side: "offering" | "seeking",
  category: string,
  skills: string[],
  description?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, agentId, side, category, JSON.stringify({ skills }), description ?? null],
  });
  return id;
}

function makeReq(agentId: string, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest(`http://localhost:3000/api/matches/batch?agent_id=${agentId}`, {
    method: "GET",
    headers,
  });
}

describe("GET /api/matches/batch", () => {
  it("requires authentication", async () => {
    const res = await GET(makeReq("agent-1"));
    expect(res.status).toBe(401);
  });

  it("rejects mismatched agent_id", async () => {
    const apiKey = await registerKey("alice");
    const res = await GET(makeReq("bob", apiKey));
    expect(res.status).toBe(403);
  });

  it("returns empty profiles array when agent has no profiles", async () => {
    const apiKey = await registerKey("agent-empty");
    const res = await GET(makeReq("agent-empty", apiKey));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent_id).toBe("agent-empty");
    expect(data.profiles).toEqual([]);
    expect(data.total_matches).toBe(0);
  });

  it("returns matches grouped by profile", async () => {
    const apiKey = await registerKey("alice");
    const aliceProfile = await createProfile(
      "alice",
      "offering",
      "freelance-dev",
      ["typescript", "react"],
      "I build web apps",
    );
    await createProfile(
      "bob",
      "seeking",
      "freelance-dev",
      ["typescript", "react"],
      "Need a web dev",
    );

    const res = await GET(makeReq("alice", apiKey));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.agent_id).toBe("alice");
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].profile_id).toBe(aliceProfile);
    expect(data.profiles[0].category).toBe("freelance-dev");
    expect(data.profiles[0].side).toBe("offering");
    expect(data.profiles[0].matches).toHaveLength(1);
    expect(data.profiles[0].matches[0].match_id).toBeDefined();
    expect(data.profiles[0].matches[0].overlap).toBeDefined();
    expect(data.profiles[0].matches[0].counterpart_skills).toEqual(["typescript", "react"]);
    expect(data.total_matches).toBe(1);
  });

  it("handles multiple profiles with different matches", async () => {
    const apiKey = await registerKey("alice");

    const devProfile = await createProfile(
      "alice",
      "offering",
      "freelance-dev",
      ["typescript"],
      "Dev services",
    );
    const designProfile = await createProfile(
      "alice",
      "offering",
      "design",
      ["figma"],
      "Design services",
    );

    await createProfile("bob", "seeking", "freelance-dev", ["typescript"], "Need a dev");
    await createProfile("carol", "seeking", "freelance-dev", ["typescript"], "Also need a dev");
    await createProfile("dave", "seeking", "design", ["figma"], "Need a designer");

    const res = await GET(makeReq("alice", apiKey));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.profiles).toHaveLength(2);

    const devResult = data.profiles.find(
      (p: { profile_id: string }) => p.profile_id === devProfile,
    );
    const designResult = data.profiles.find(
      (p: { profile_id: string }) => p.profile_id === designProfile,
    );

    expect(devResult).toBeDefined();
    expect(devResult.matches).toHaveLength(2);
    expect(devResult.category).toBe("freelance-dev");

    expect(designResult).toBeDefined();
    expect(designResult.matches).toHaveLength(1);
    expect(designResult.category).toBe("design");

    expect(data.total_matches).toBe(3);
  });

  it("excludes inactive profiles", async () => {
    const apiKey = await registerKey("alice");
    const profileId = await createProfile("alice", "offering", "freelance-dev", ["typescript"]);
    await createProfile("bob", "seeking", "freelance-dev", ["typescript"]);

    await db.execute({ sql: "UPDATE profiles SET active = 0 WHERE id = ?", args: [profileId] });

    const res = await GET(makeReq("alice", apiKey));
    const data = await res.json();
    expect(data.profiles).toHaveLength(0);
    expect(data.total_matches).toBe(0);
  });

  it("requires agent_id query parameter", async () => {
    const apiKey = await registerKey("alice");
    const req = new NextRequest("http://localhost:3000/api/matches/batch", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
