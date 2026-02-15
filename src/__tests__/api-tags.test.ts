import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST } from "@/app/api/connect/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[profileId]/route";
import { GET as getAgentProfiles } from "@/app/api/connect/[agentId]/route";
import { GET as searchProfiles } from "@/app/api/search/route";
import { GET as getTags } from "@/app/api/tags/route";
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

async function getApiKey(agentId: string): Promise<string> {
  return createApiKey(agentId);
}

function makeConnectRequest(body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return new NextRequest("http://localhost:3000/api/connect", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

async function createProfile(
  agentId: string,
  opts?: { tags?: string[]; category?: string; side?: string; description?: string },
) {
  const key = await getApiKey(agentId);
  const body: Record<string, unknown> = {
    agent_id: agentId,
    side: opts?.side ?? "offering",
    category: opts?.category ?? "dev",
    params: { skills: ["typescript"] },
    description: opts?.description ?? "A test profile",
  };
  if (opts?.tags !== undefined) body.tags = opts.tags;
  const res = await POST(makeConnectRequest(body, key));
  const data = await res.json();
  return { key, profileId: data.profile_id, res };
}

describe("Tags in POST /api/connect", () => {
  it("creates a profile with tags", async () => {
    const { profileId } = await createProfile("agent-1", { tags: ["ai", "typescript", "web3"] });

    const result = await db.execute({
      sql: "SELECT tag FROM profile_tags WHERE profile_id = ? ORDER BY tag",
      args: [profileId],
    });
    expect(result.rows.map((r) => r.tag)).toEqual(["ai", "typescript", "web3"]);
  });

  it("lowercases and trims tags", async () => {
    const { profileId } = await createProfile("agent-1", {
      tags: ["  AI  ", "TypeScript", " Web3 "],
    });

    const result = await db.execute({
      sql: "SELECT tag FROM profile_tags WHERE profile_id = ? ORDER BY tag",
      args: [profileId],
    });
    expect(result.rows.map((r) => r.tag)).toEqual(["ai", "typescript", "web3"]);
  });

  it("rejects more than 10 tags", async () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const key = await getApiKey("agent-1");
    const res = await POST(
      makeConnectRequest(
        {
          agent_id: "agent-1",
          side: "offering",
          category: "dev",
          params: {},
          tags,
        },
        key,
      ),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Maximum 10 tags");
  });

  it("rejects tags longer than 30 characters", async () => {
    const key = await getApiKey("agent-1");
    const res = await POST(
      makeConnectRequest(
        {
          agent_id: "agent-1",
          side: "offering",
          category: "dev",
          params: {},
          tags: ["a".repeat(31)],
        },
        key,
      ),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("exceeds 30 characters");
  });

  it("creates profile without tags (backwards compatible)", async () => {
    const { profileId, res } = await createProfile("agent-1");
    expect(res.status).toBe(200);
    expect(profileId).toBeTruthy();

    const result = await db.execute({
      sql: "SELECT tag FROM profile_tags WHERE profile_id = ?",
      args: [profileId],
    });
    expect(result.rows).toHaveLength(0);
  });
});

describe("Tags in PATCH /api/profiles/:profileId", () => {
  it("updates tags on an existing profile", async () => {
    const { key, profileId } = await createProfile("agent-1", { tags: ["old-tag"] });

    const patchReq = new NextRequest(`http://localhost:3000/api/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_id: "agent-1", tags: ["new-tag-1", "new-tag-2"] }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
    const res = await patchProfile(patchReq, { params: Promise.resolve({ profileId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tags).toEqual(["new-tag-1", "new-tag-2"]);
  });

  it("allows updating only tags without params or description", async () => {
    const { key, profileId } = await createProfile("agent-1");

    const patchReq = new NextRequest(`http://localhost:3000/api/profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_id: "agent-1", tags: ["solo-tag"] }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    });
    const res = await patchProfile(patchReq, { params: Promise.resolve({ profileId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tags).toEqual(["solo-tag"]);
  });
});

describe("Tags in GET /api/profiles/:profileId", () => {
  it("returns tags in profile response", async () => {
    const { profileId } = await createProfile("agent-1", { tags: ["react", "node"] });

    const req = new NextRequest(`http://localhost:3000/api/profiles/${profileId}`);
    const res = await getProfile(req, { params: Promise.resolve({ profileId }) });
    const data = await res.json();

    expect(data.tags).toEqual(["node", "react"]);
  });
});

describe("Tags in GET /api/connect/:agentId", () => {
  it("returns tags in agent profiles", async () => {
    await createProfile("agent-1", { tags: ["ml", "python"] });

    const req = new NextRequest("http://localhost:3000/api/connect/agent-1");
    const res = await getAgentProfiles(req, { params: Promise.resolve({ agentId: "agent-1" }) });
    const data = await res.json();

    expect(data.profiles[0].tags).toEqual(["ml", "python"]);
  });
});

describe("Tags in GET /api/search", () => {
  it("filters profiles by tags", async () => {
    await createProfile("agent-1", { tags: ["ai", "ml"], description: "AI agent" });
    await createProfile("agent-2", {
      tags: ["web", "react"],
      description: "Web agent",
      category: "design",
    });
    await createProfile("agent-3", {
      tags: ["ai", "web3"],
      description: "Web3 agent",
      category: "crypto",
    });

    const req = new NextRequest("http://localhost:3000/api/search?tags=ai");
    const res = await searchProfiles(req);
    const data = await res.json();

    expect(data.profiles).toHaveLength(2);
    const agentIds = data.profiles.map((p: { agent_id: string }) => p.agent_id).sort();
    expect(agentIds).toEqual(["agent-1", "agent-3"]);
  });

  it("matches profiles with ANY of the given tags", async () => {
    await createProfile("agent-1", { tags: ["ai"], description: "AI" });
    await createProfile("agent-2", { tags: ["web"], description: "Web", category: "design" });
    await createProfile("agent-3", {
      tags: ["blockchain"],
      description: "Chain",
      category: "crypto",
    });

    const req = new NextRequest("http://localhost:3000/api/search?tags=ai,web");
    const res = await searchProfiles(req);
    const data = await res.json();

    expect(data.profiles).toHaveLength(2);
  });

  it("includes tags in search results", async () => {
    await createProfile("agent-1", { tags: ["ai", "ml"] });

    const req = new NextRequest("http://localhost:3000/api/search");
    const res = await searchProfiles(req);
    const data = await res.json();

    expect(data.profiles[0].tags).toEqual(["ai", "ml"]);
  });
});

describe("GET /api/tags", () => {
  it("returns popular tags with counts", async () => {
    await createProfile("agent-1", { tags: ["ai", "ml"] });
    await createProfile("agent-2", { tags: ["ai", "web"], category: "design" });
    await createProfile("agent-3", { tags: ["ai", "blockchain"], category: "crypto" });

    const req = new NextRequest("http://localhost:3000/api/tags");
    const res = await getTags(req);
    const data = await res.json();

    expect(data.tags[0]).toEqual({ tag: "ai", count: 3 });
    expect(data.tags).toHaveLength(4);
  });

  it("excludes tags from inactive profiles", async () => {
    await createProfile("agent-1", { tags: ["active-tag"] });
    await createProfile("agent-1", { tags: ["new-tag"] }); // replaces previous, deactivating it

    const req = new NextRequest("http://localhost:3000/api/tags");
    const res = await getTags(req);
    const data = await res.json();

    const tagNames = data.tags.map((t: { tag: string }) => t.tag);
    expect(tagNames).toContain("new-tag");
    expect(tagNames).not.toContain("active-tag");
  });

  it("respects limit parameter", async () => {
    await createProfile("agent-1", { tags: ["a", "b", "c", "d", "e"] });

    const req = new NextRequest("http://localhost:3000/api/tags?limit=2");
    const res = await getTags(req);
    const data = await res.json();

    expect(data.tags).toHaveLength(2);
  });
});
