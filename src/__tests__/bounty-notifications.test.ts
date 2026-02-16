import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate, ensureDb } from "@/lib/db";
import type { Client } from "@libsql/client";
import { POST } from "@/app/api/bounties/route";
import { notifyMatchingAgentsForBounty } from "@/lib/bounty-notifications";
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

function makeRequest(url: string, body: unknown, apiKey: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

async function createProfile(agentId: string, side: string, category: string, skills: string[] = []) {
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    args: [
      crypto.randomUUID(),
      agentId,
      side,
      category,
      JSON.stringify({ skills }),
      `${agentId} profile`,
    ],
  });
}

async function getNotifications(agentId: string) {
  const result = await db.execute({
    sql: "SELECT * FROM notifications WHERE agent_id = ? ORDER BY created_at DESC",
    args: [agentId],
  });
  return result.rows;
}

describe("notifyMatchingAgentsForBounty", () => {
  it("notifies agents with offering profiles in same category", async () => {
    await createProfile("agent-a", "offering", "development", ["React", "TypeScript"]);
    await createProfile("agent-b", "offering", "development", ["Python"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "Build a React app",
      category: "development",
      skills: ["React"],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(2);

    const notifsA = await getNotifications("agent-a");
    expect(notifsA).toHaveLength(1);
    expect(notifsA[0].type).toBe("bounty_posted");
    expect(notifsA[0].summary).toContain("Build a React app");
    expect(notifsA[0].summary).toContain("matching skills: React");

    const notifsB = await getNotifications("agent-b");
    expect(notifsB).toHaveLength(1);
    expect(notifsB[0].summary).not.toContain("matching skills");
  });

  it("does not notify the bounty creator", async () => {
    await createProfile("creator", "offering", "development", ["React"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "My own bounty",
      category: "development",
      skills: ["React"],
      creator_agent_id: "creator",
    });

    expect(count).toBe(0);
    const notifs = await getNotifications("creator");
    expect(notifs).toHaveLength(0);
  });

  it("does not notify agents in different categories", async () => {
    await createProfile("agent-a", "offering", "design", ["Figma"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "Build a React app",
      category: "development",
      skills: ["React"],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(0);
  });

  it("does not notify agents with seeking profiles", async () => {
    await createProfile("agent-a", "seeking", "development", ["React"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "Build a React app",
      category: "development",
      skills: ["React"],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(0);
  });

  it("does not notify agents with inactive profiles", async () => {
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params, description, active) VALUES (?, ?, ?, ?, ?, ?, 0)",
      args: [crypto.randomUUID(), "agent-a", "offering", "development", JSON.stringify({ skills: ["React"] }), "inactive"],
    });

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "Build a React app",
      category: "development",
      skills: ["React"],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(0);
  });

  it("deduplicates agents with multiple profiles in same category", async () => {
    await createProfile("agent-a", "offering", "development", ["React"]);
    await createProfile("agent-a", "offering", "development", ["TypeScript"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "Build something",
      category: "development",
      skills: [],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(1);
    const notifs = await getNotifications("agent-a");
    expect(notifs).toHaveLength(1);
  });

  it("works with bounties that have no skills", async () => {
    await createProfile("agent-a", "offering", "development", ["React"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "General dev work",
      category: "development",
      skills: [],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(1);
    const notifs = await getNotifications("agent-a");
    expect(notifs[0].summary).toBe('New bounty in development: "General dev work"');
  });

  it("skill matching is case-insensitive", async () => {
    await createProfile("agent-a", "offering", "development", ["react", "typescript"]);

    const count = await notifyMatchingAgentsForBounty(db, {
      id: "bounty-1",
      title: "React project",
      category: "development",
      skills: ["React", "TypeScript"],
      creator_agent_id: "bounty-creator",
    });

    expect(count).toBe(1);
    const notifs = await getNotifications("agent-a");
    expect(notifs[0].summary).toContain("matching skills: React, TypeScript");
  });
});

describe("POST /api/bounties - notification integration", () => {
  it("creates notifications for matching agents when bounty is posted", async () => {
    // Create offering agent
    const offeringKey = await createApiKey("offering-agent");
    await createProfile("offering-agent", "offering", "development", ["React"]);

    // Create bounty as different agent
    const creatorKey = await createApiKey("creator-agent");
    const res = await POST(
      makeRequest("/api/bounties", {
        agent_id: "creator-agent",
        title: "Need React dev",
        category: "development",
        skills: ["React"],
        budget_min: 100,
        budget_max: 500,
      }, creatorKey),
    );

    expect(res.status).toBe(201);

    // Wait a tick for fire-and-forget notification
    await new Promise((r) => setTimeout(r, 50));

    const notifs = await getNotifications("offering-agent");
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("bounty_posted");
    expect(notifs[0].summary).toContain("Need React dev");
    expect(notifs[0].from_agent_id).toBe("creator-agent");
  });
});
