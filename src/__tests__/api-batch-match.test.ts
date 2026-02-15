import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { GET } from "@/app/api/matches/batch/route";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";

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

function registerKey(agentId: string): string {
  const { raw, hash } = generateApiKey();
  db.prepare("INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)").run(
    crypto.randomUUID(), agentId, hash
  );
  return raw;
}

function createProfile(agentId: string, side: "offering" | "seeking", category: string, skills: string[], description?: string): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, agentId, side, category, JSON.stringify({ skills }), description ?? null);
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
    const apiKey = registerKey("alice");
    const res = await GET(makeReq("bob", apiKey));
    expect(res.status).toBe(403);
  });

  it("returns empty profiles array when agent has no profiles", async () => {
    const apiKey = registerKey("agent-empty");
    const res = await GET(makeReq("agent-empty", apiKey));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent_id).toBe("agent-empty");
    expect(data.profiles).toEqual([]);
    expect(data.total_matches).toBe(0);
  });

  it("returns matches grouped by profile", async () => {
    const apiKey = registerKey("alice");
    // Alice offers dev skills
    const aliceProfile = createProfile("alice", "offering", "freelance-dev", ["typescript", "react"], "I build web apps");
    // Bob seeks dev skills (should match Alice)
    createProfile("bob", "seeking", "freelance-dev", ["typescript", "react"], "Need a web dev");

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
    const apiKey = registerKey("alice");

    // Alice has two profiles in different categories
    const devProfile = createProfile("alice", "offering", "freelance-dev", ["typescript"], "Dev services");
    const designProfile = createProfile("alice", "offering", "design", ["figma"], "Design services");

    // Counterparts
    createProfile("bob", "seeking", "freelance-dev", ["typescript"], "Need a dev");
    createProfile("carol", "seeking", "freelance-dev", ["typescript"], "Also need a dev");
    createProfile("dave", "seeking", "design", ["figma"], "Need a designer");

    const res = await GET(makeReq("alice", apiKey));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.profiles).toHaveLength(2);

    const devResult = data.profiles.find((p: { profile_id: string }) => p.profile_id === devProfile);
    const designResult = data.profiles.find((p: { profile_id: string }) => p.profile_id === designProfile);

    expect(devResult).toBeDefined();
    expect(devResult.matches).toHaveLength(2);
    expect(devResult.category).toBe("freelance-dev");

    expect(designResult).toBeDefined();
    expect(designResult.matches).toHaveLength(1);
    expect(designResult.category).toBe("design");

    expect(data.total_matches).toBe(3);
  });

  it("excludes inactive profiles", async () => {
    const apiKey = registerKey("alice");
    const profileId = createProfile("alice", "offering", "freelance-dev", ["typescript"]);
    createProfile("bob", "seeking", "freelance-dev", ["typescript"]);

    // Deactivate alice's profile
    db.prepare("UPDATE profiles SET active = 0 WHERE id = ?").run(profileId);

    const res = await GET(makeReq("alice", apiKey));
    const data = await res.json();
    expect(data.profiles).toHaveLength(0);
    expect(data.total_matches).toBe(0);
  });

  it("requires agent_id query parameter", async () => {
    const apiKey = registerKey("alice");
    const req = new NextRequest("http://localhost:3000/api/matches/batch", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
