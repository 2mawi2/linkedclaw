import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { createApiKey } from "@/__tests__/test-helpers";
import { POST as connectPOST } from "@/app/api/connect/route";
import { GET as matchesGET } from "@/app/api/matches/[profileId]/route";
import { POST as messagesPOST } from "@/app/api/deals/[matchId]/messages/route";
import { POST as approvePOST } from "@/app/api/deals/[matchId]/approve/route";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { POST as inboxReadPOST } from "@/app/api/inbox/read/route";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

function req(url: string, opts?: RequestInit & { headers?: Record<string, string> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, BASE), opts as any);
}

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

async function createProfile(agentId: string, apiKey: string, side: string) {
  const res = await connectPOST(
    req("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        agent_id: agentId,
        side,
        category: "dev",
        params: { skills: ["typescript"], rate_min: 50, rate_max: 100, remote: "remote" },
        description: `${agentId} profile`,
      }),
    }),
  );
  const data = await res.json();
  return data.profile_id as string;
}

describe("GET /api/inbox", () => {
  it("returns empty inbox for new agent", async () => {
    const key = await getApiKey("agent-1");
    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unread_count).toBe(0);
    expect(data.notifications).toEqual([]);
  });

  it("requires auth", async () => {
    const res = await inboxGET(req("/api/inbox?agent_id=agent-1"));
    expect(res.status).toBe(401);
  });

  it("requires agent_id", async () => {
    const key = await getApiKey("agent-1");
    const res = await inboxGET(
      req("/api/inbox", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("blocks access to other agent inbox", async () => {
    const key = await getApiKey("agent-1");
    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-2", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("creates notification on new match", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    await createProfile("agent-1", key1, "offering");
    await createProfile("agent-2", key2, "seeking");

    // Auto-matching on connect notifies agent-1 (counterpart of agent-2's listing)
    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key1}` },
      }),
    );
    const data = await res.json();
    expect(data.unread_count).toBe(1);
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].type).toBe("new_match");
    expect(data.notifications[0].from_agent_id).toBe("agent-2");
    expect(data.notifications[0].read).toBe(false);
  });

  it("creates notification on message", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const profileA = await createProfile("agent-1", key1, "offering");
    await createProfile("agent-2", key2, "seeking");

    // Auto-matching already created the match during connect
    // Get the match from agent-1's perspective
    const matchRes = await matchesGET(req(`/api/matches/${profileA}`), {
      params: Promise.resolve({ profileId: profileA }),
    });
    const matchData = await matchRes.json();
    const matchId = matchData.matches[0].match_id;

    await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
        body: JSON.stringify({ agent_id: "agent-1", content: "Hello!" }),
      }),
      { params: Promise.resolve({ matchId }) },
    );

    // agent-2 gets message notification; match notification went to agent-1
    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-2", {
        headers: { Authorization: `Bearer ${key2}` },
      }),
    );
    const data = await res.json();
    expect(data.unread_count).toBe(1);
    const types = data.notifications.map((n: { type: string }) => n.type);
    expect(types).toContain("message_received");
  });

  it("creates notification on deal approved", async () => {
    const key1 = await getApiKey("agent-1");
    const key2 = await getApiKey("agent-2");
    const profileA = await createProfile("agent-1", key1, "offering");
    await createProfile("agent-2", key2, "seeking");

    const matchRes = await matchesGET(req(`/api/matches/${profileA}`), {
      params: Promise.resolve({ profileId: profileA }),
    });
    const matchData = await matchRes.json();
    const matchId = matchData.matches[0].match_id;

    // Send proposal
    await messagesPOST(
      req(`/api/deals/${matchId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
        body: JSON.stringify({
          agent_id: "agent-1",
          content: "Deal!",
          message_type: "proposal",
          proposed_terms: { rate: 50 },
        }),
      }),
      { params: Promise.resolve({ matchId }) },
    );

    // Both approve
    await approvePOST(
      req(`/api/deals/${matchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
        body: JSON.stringify({ agent_id: "agent-1", approved: true }),
      }),
      { params: Promise.resolve({ matchId }) },
    );
    await approvePOST(
      req(`/api/deals/${matchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key2}` },
        body: JSON.stringify({ agent_id: "agent-2", approved: true }),
      }),
      { params: Promise.resolve({ matchId }) },
    );

    // Both agents should have deal_approved notifications
    const res1 = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key1}` },
      }),
    );
    const data1 = await res1.json();
    const types1 = data1.notifications.map((n: { type: string }) => n.type);
    expect(types1).toContain("deal_approved");

    const res2 = await inboxGET(
      req("/api/inbox?agent_id=agent-2", {
        headers: { Authorization: `Bearer ${key2}` },
      }),
    );
    const data2 = await res2.json();
    const types2 = data2.notifications.map((n: { type: string }) => n.type);
    expect(types2).toContain("deal_approved");
  });

  it("supports unread_only filter", async () => {
    const key1 = await getApiKey("agent-1");
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary, read) VALUES (?, ?, ?, ?)",
      args: ["agent-1", "new_match", "Read one", 1],
    });
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary, read) VALUES (?, ?, ?, ?)",
      args: ["agent-1", "message_received", "Unread one", 0],
    });

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&unread_only=true", {
        headers: { Authorization: `Bearer ${key1}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].type).toBe("message_received");
  });

  it("supports limit param", async () => {
    const key1 = await getApiKey("agent-1");
    for (let i = 0; i < 5; i++) {
      await db.execute({
        sql: "INSERT INTO notifications (agent_id, type, summary) VALUES (?, ?, ?)",
        args: ["agent-1", "new_match", `Notification ${i}`],
      });
    }

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&limit=2", {
        headers: { Authorization: `Bearer ${key1}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(2);
    expect(data.unread_count).toBe(5);
  });
});

describe("POST /api/inbox/read", () => {
  it("marks all as read", async () => {
    const key1 = await getApiKey("agent-1");
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary) VALUES (?, ?, ?)",
      args: ["agent-1", "new_match", "Test 1"],
    });
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary) VALUES (?, ?, ?)",
      args: ["agent-1", "new_match", "Test 2"],
    });

    const res = await inboxReadPOST(
      req("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
        body: JSON.stringify({ agent_id: "agent-1" }),
      }),
    );
    const data = await res.json();
    expect(data.marked_read).toBe(2);

    const inboxRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", { headers: { Authorization: `Bearer ${key1}` } }),
    );
    const inboxData = await inboxRes.json();
    expect(inboxData.unread_count).toBe(0);
  });

  it("marks specific ids as read", async () => {
    const key1 = await getApiKey("agent-1");
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary) VALUES (?, ?, ?)",
      args: ["agent-1", "new_match", "Test 1"],
    });
    await db.execute({
      sql: "INSERT INTO notifications (agent_id, type, summary) VALUES (?, ?, ?)",
      args: ["agent-1", "new_match", "Test 2"],
    });

    const res = await inboxReadPOST(
      req("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key1}` },
        body: JSON.stringify({ agent_id: "agent-1", notification_ids: [1] }),
      }),
    );
    const data = await res.json();
    expect(data.marked_read).toBe(1);

    const inboxRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", { headers: { Authorization: `Bearer ${key1}` } }),
    );
    const inboxData = await inboxRes.json();
    expect(inboxData.unread_count).toBe(1);
  });

  it("requires auth", async () => {
    const res = await inboxReadPOST(
      req("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: "agent-1" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
