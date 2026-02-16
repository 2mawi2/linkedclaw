import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { createApiKey } from "@/__tests__/test-helpers";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { POST as inboxReadPOST } from "@/app/api/inbox/read/route";
import { POST as inboxDeletePOST } from "@/app/api/inbox/delete/route";
import { createNotification } from "@/lib/notifications";
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

async function seedNotifications(agentId: string) {
  await createNotification(db, {
    agent_id: agentId,
    type: "new_match",
    summary: "New match found",
    match_id: "match-1",
  });
  await createNotification(db, {
    agent_id: agentId,
    type: "message_received",
    summary: "You got a message",
    match_id: "match-1",
    from_agent_id: "other-agent",
  });
  await createNotification(db, {
    agent_id: agentId,
    type: "deal_proposed",
    summary: "New proposal received",
    match_id: "match-2",
  });
  await createNotification(db, {
    agent_id: agentId,
    type: "deal_completed",
    summary: "Deal completed!",
    match_id: "match-3",
  });
  await createNotification(db, {
    agent_id: agentId,
    type: "bounty_posted",
    summary: "New bounty in your category",
  });
}

describe("Notification Center - Type Filtering", () => {
  it("filters notifications by type", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&type=new_match", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].type).toBe("new_match");
  });

  it("returns all notifications without type filter", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(5);
  });

  it("returns empty for non-matching type filter", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&type=listing_expired", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(0);
    expect(res.headers.get("X-Total-Count")).toBe("0");
  });

  it("combines type filter with unread_only", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    // Mark the match notification as read
    const listRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1&type=new_match", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const listData = await listRes.json();
    const matchId = listData.notifications[0].id;

    await inboxReadPOST(
      req("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-1", notification_ids: [matchId] }),
      }),
    );

    // Filter by new_match + unread_only should return 0
    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&type=new_match&unread_only=true", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(0);
  });
});

describe("Notification Center - Delete", () => {
  it("deletes specific notifications by ID", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    // Get notification IDs
    const listRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const listData = await listRes.json();
    const ids = [listData.notifications[0].id, listData.notifications[1].id];

    const res = await inboxDeletePOST(
      req("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-1", notification_ids: ids }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(2);

    // Verify deletion
    const afterRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const afterData = await afterRes.json();
    expect(afterData.notifications).toHaveLength(3);
  });

  it("deletes all read notifications", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    // Mark 2 as read
    const listRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const listData = await listRes.json();
    const readIds = [listData.notifications[0].id, listData.notifications[1].id];

    await inboxReadPOST(
      req("/api/inbox/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-1", notification_ids: readIds }),
      }),
    );

    // Delete all read
    const res = await inboxDeletePOST(
      req("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-1", read_only: true }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(2);

    // Only unread remain
    const afterRes = await inboxGET(
      req("/api/inbox?agent_id=agent-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const afterData = await afterRes.json();
    expect(afterData.notifications).toHaveLength(3);
    expect(afterData.notifications.every((n: { read: boolean }) => !n.read)).toBe(true);
  });

  it("rejects delete without IDs or read_only", async () => {
    const key = await createApiKey("agent-1");

    const res = await inboxDeletePOST(
      req("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-1" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects delete from another agent", async () => {
    const key = await createApiKey("agent-1");

    const res = await inboxDeletePOST(
      req("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ agent_id: "agent-2", notification_ids: [1] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("requires auth", async () => {
    const res = await inboxDeletePOST(
      req("/api/inbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: "agent-1", notification_ids: [1] }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("Notification Center - Pagination", () => {
  it("paginates with limit and offset", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&limit=2&offset=0", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data = await res.json();
    expect(data.notifications).toHaveLength(2);
    expect(res.headers.get("X-Total-Count")).toBe("5");

    // Page 2
    const res2 = await inboxGET(
      req("/api/inbox?agent_id=agent-1&limit=2&offset=2", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data2 = await res2.json();
    expect(data2.notifications).toHaveLength(2);

    // Page 3
    const res3 = await inboxGET(
      req("/api/inbox?agent_id=agent-1&limit=2&offset=4", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data3 = await res3.json();
    expect(data3.notifications).toHaveLength(1);
  });

  it("type filter affects total count for pagination", async () => {
    const key = await createApiKey("agent-1");
    await seedNotifications("agent-1");

    const res = await inboxGET(
      req("/api/inbox?agent_id=agent-1&type=message_received", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    const data = await res.json();
    expect(res.headers.get("X-Total-Count")).toBe("1");
    expect(data.notifications).toHaveLength(1);
  });
});
