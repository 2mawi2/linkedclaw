import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, migrate, _setDb } from "../db";
import type { Client } from "@libsql/client";
import { randomUUID } from "crypto";

// Test helpers
let db: Client;
let restore: () => void;
let apiKey: string;
let agentId: string;
let apiKey2: string;
let agentId2: string;
let matchId: string;

async function createTestAgent(db: Client, id: string): Promise<{ apiKey: string; agentId: string }> {
  const keyId = randomUUID();
  const rawKey = `lc_test_${randomUUID().replace(/-/g, "")}`;
  const { createHash } = await import("crypto");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [keyId, id, keyHash],
  });
  return { apiKey: rawKey, agentId: id };
}

async function createTestDeal(db: Client, agent1: string, agent2: string, status: string = "approved"): Promise<string> {
  const profileA = randomUUID();
  const profileB = randomUUID();
  const mId = randomUUID();

  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'offering', 'dev', '{}')",
    args: [profileA, agent1],
  });
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'seeking', 'dev', '{}')",
    args: [profileB, agent2],
  });
  await db.execute({
    sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, '{}', ?)",
    args: [mId, profileA, profileB, status],
  });

  return mId;
}

async function req(method: string, path: string, key: string, body?: unknown): Promise<Response> {
  const { GET, POST, PATCH } = await import("../../app/api/deals/[matchId]/milestones/route");

  const url = `http://localhost${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
  if (body) init.body = JSON.stringify(body);

  const request = new Request(url, init);
  const params = Promise.resolve({ matchId: path.split("/")[3] });

  if (method === "GET") return GET(request as any, { params } as any);
  if (method === "POST") return POST(request as any, { params } as any);
  if (method === "PATCH") return PATCH(request as any, { params } as any);
  throw new Error(`Unknown method: ${method}`);
}

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);

  const a1 = await createTestAgent(db, "agent-alpha");
  apiKey = a1.apiKey;
  agentId = a1.agentId;

  const a2 = await createTestAgent(db, "agent-beta");
  apiKey2 = a2.apiKey;
  agentId2 = a2.agentId;

  matchId = await createTestDeal(db, agentId, agentId2, "approved");

  return () => {
    restore();
    db.close();
  };
});

describe("Milestones API", () => {
  it("creates a milestone", async () => {
    const res = await req("POST", `/api/deals/${matchId}/milestones`, apiKey, {
      title: "Design mockups",
      description: "Create initial wireframes",
      order_index: 1,
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("Design mockups");
    expect(data.status).toBe("pending");
    expect(data.order_index).toBe(1);
  });

  it("lists milestones in order", async () => {
    await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Step 2", order_index: 2 });
    await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Step 1", order_index: 1 });
    await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Step 3", order_index: 3 });

    const res = await req("GET", `/api/deals/${matchId}/milestones`, apiKey);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.milestones).toHaveLength(3);
    expect(data.milestones[0].title).toBe("Step 1");
    expect(data.milestones[1].title).toBe("Step 2");
    expect(data.milestones[2].title).toBe("Step 3");
    expect(data.progress.total).toBe(3);
    expect(data.progress.completed).toBe(0);
    expect(data.progress.percentage).toBe(0);
  });

  it("updates milestone status to completed", async () => {
    const create = await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Task 1" });
    const { id: milestoneId } = await create.json();

    const res = await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey, {
      milestone_id: milestoneId,
      status: "completed",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("completed");
    expect(data.completed_at).toBeTruthy();
  });

  it("tracks progress correctly", async () => {
    const m1 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "A" })).json();
    const m2 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "B" })).json();
    await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "C" });

    // Complete 2 out of 3
    await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey, { milestone_id: m1.id, status: "completed" });
    await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey2, { milestone_id: m2.id, status: "completed" });

    const res = await req("GET", `/api/deals/${matchId}/milestones`, apiKey);
    const data = await res.json();
    expect(data.progress.completed).toBe(2);
    expect(data.progress.total).toBe(3);
    expect(data.progress.percentage).toBe(67);
  });

  it("cancelled milestones don't count in progress", async () => {
    const m1 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Keep" })).json();
    const m2 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Cancel" })).json();

    await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey, { milestone_id: m1.id, status: "completed" });
    await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey, { milestone_id: m2.id, status: "cancelled" });

    const res = await req("GET", `/api/deals/${matchId}/milestones`, apiKey);
    const data = await res.json();
    expect(data.progress.total).toBe(1); // cancelled excluded
    expect(data.progress.completed).toBe(1);
    expect(data.progress.percentage).toBe(100);
  });

  it("rejects milestone creation on expired deals", async () => {
    const expiredMatch = await createTestDeal(db, agentId, agentId2, "expired");
    const res = await req("POST", `/api/deals/${expiredMatch}/milestones`, apiKey, { title: "Too late" });
    expect(res.status).toBe(400);
  });

  it("rejects non-participants", async () => {
    const outsider = await createTestAgent(db, "agent-outsider");
    const res = await req("GET", `/api/deals/${matchId}/milestones`, outsider.apiKey);
    expect(res.status).toBe(403);
  });

  it("rejects unauthorized requests", async () => {
    const res = await req("GET", `/api/deals/${matchId}/milestones`, "invalid_key");
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent deal", async () => {
    const res = await req("GET", `/api/deals/${randomUUID()}/milestones`, apiKey);
    expect(res.status).toBe(404);
  });

  it("creates system message on milestone update", async () => {
    const m = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "Review code" })).json();
    await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey, { milestone_id: m.id, status: "in_progress" });

    const msgs = await db.execute({
      sql: "SELECT * FROM messages WHERE match_id = ? AND message_type = 'system'",
      args: [matchId],
    });
    expect(msgs.rows.length).toBe(1);
    expect((msgs.rows[0].content as string)).toContain("Review code");
    expect((msgs.rows[0].content as string)).toContain("in_progress");
  });

  it("validates required title field", async () => {
    const res = await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { description: "no title" });
    expect(res.status).toBe(400);
  });

  it("both participants can create and update milestones", async () => {
    // Agent A creates
    const m1 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey, { title: "From A" })).json();
    // Agent B creates
    const m2 = await (await req("POST", `/api/deals/${matchId}/milestones`, apiKey2, { title: "From B" })).json();
    // Agent B completes A's milestone
    const res = await req("PATCH", `/api/deals/${matchId}/milestones`, apiKey2, { milestone_id: m1.id, status: "completed" });
    expect(res.status).toBe(200);

    const list = await (await req("GET", `/api/deals/${matchId}/milestones`, apiKey)).json();
    expect(list.milestones).toHaveLength(2);
  });

  it("supports due_date on milestones", async () => {
    const res = await req("POST", `/api/deals/${matchId}/milestones`, apiKey, {
      title: "Deadline task",
      due_date: "2026-03-01T00:00:00Z",
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.due_date).toBe("2026-03-01T00:00:00Z");
  });
});
