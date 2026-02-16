/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb, migrate, _setDb } from "@/lib/db";
import { Client } from "@libsql/client";
import { v4 as uuid } from "uuid";

let db: Client;
let restore: () => void;

beforeAll(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  return () => restore();
});

async function createDealWithMessages() {
  const profileAId = uuid();
  const profileBId = uuid();
  const matchId = uuid();

  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, 'agent-a', 'offering', 'dev', '{}')`,
    args: [profileAId],
  });
  await db.execute({
    sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, 'agent-b', 'seeking', 'dev', '{}')`,
    args: [profileBId],
  });
  await db.execute({
    sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, '{"matching_skills":[],"rate_overlap":null,"remote_compatible":false,"score":0}', 'negotiating')`,
    args: [matchId, profileAId, profileBId],
  });

  // Add a negotiation message
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, 'agent-a', 'Hello!', 'negotiation')`,
    args: [matchId],
  });
  // Add a proposal
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type, proposed_terms) VALUES (?, 'agent-a', 'My proposal', 'proposal', '{"rate":100}')`,
    args: [matchId],
  });
  // Add a system message
  await db.execute({
    sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, 'system', 'Deal status changed', 'system')`,
    args: [matchId],
  });

  return { matchId, profileAId, profileBId };
}

describe("GET /api/deals/[matchId]/timeline", () => {
  it("returns 404 for non-existent deal", async () => {
    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request("http://localhost/api/deals/nonexistent/timeline");
    const res = await GET(req as any, { params: Promise.resolve({ matchId: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns timeline events for a deal", async () => {
    const { matchId } = await createDealWithMessages();
    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.match_id).toBe(matchId);
    expect(json.event_count).toBeGreaterThanOrEqual(4); // created + 3 messages
    expect(json.events).toBeInstanceOf(Array);

    // First event should be deal_created
    expect(json.events[0].type).toBe("deal_created");

    // Check all event types are present
    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("deal_created");
    expect(types).toContain("message");
    expect(types).toContain("proposal");
    expect(types).toContain("status_change");
  });

  it("includes approval events", async () => {
    const { matchId } = await createDealWithMessages();

    await db.execute({
      sql: `INSERT INTO approvals (match_id, agent_id, approved) VALUES (?, 'agent-a', 1)`,
      args: [matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("approval");

    const approvalEvent = json.events.find((e: any) => e.type === "approval");
    expect(approvalEvent.actor).toBe("agent-a");
    expect(approvalEvent.summary).toContain("approved");
  });

  it("includes dispute events", async () => {
    const { matchId } = await createDealWithMessages();
    const disputeId = uuid();

    await db.execute({
      sql: `INSERT INTO disputes (id, match_id, filed_by_agent_id, reason, status) VALUES (?, ?, 'agent-b', 'Incomplete work', 'open')`,
      args: [disputeId, matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("dispute_filed");

    const disputeEvent = json.events.find((e: any) => e.type === "dispute_filed");
    expect(disputeEvent.actor).toBe("agent-b");
    expect(disputeEvent.detail).toContain("Incomplete");
  });

  it("includes milestone events", async () => {
    const { matchId } = await createDealWithMessages();
    const milestoneId = uuid();

    await db.execute({
      sql: `INSERT INTO deal_milestones (id, match_id, title, status, position, created_by) VALUES (?, ?, 'Design phase', 'pending', 0, 'agent-a')`,
      args: [milestoneId, matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("milestone_created");

    const milestoneEvent = json.events.find((e: any) => e.type === "milestone_created");
    expect(milestoneEvent.summary).toContain("Design phase");
  });

  it("includes completion evidence events", async () => {
    const { matchId } = await createDealWithMessages();

    await db.execute({
      sql: `INSERT INTO deal_completions (match_id, agent_id, evidence) VALUES (?, 'agent-a', 'All tasks done, see PR #42')`,
      args: [matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("completion_submitted");

    const compEvent = json.events.find((e: any) => e.type === "completion_submitted");
    expect(compEvent.actor).toBe("agent-a");
    expect(compEvent.detail).toContain("PR #42");
  });

  it("includes review events", async () => {
    const { matchId } = await createDealWithMessages();
    const reviewId = uuid();

    await db.execute({
      sql: `INSERT INTO reviews (id, match_id, reviewer_agent_id, reviewed_agent_id, rating, comment) VALUES (?, ?, 'agent-a', 'agent-b', 5, 'Great work!')`,
      args: [reviewId, matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("review_submitted");

    const reviewEvent = json.events.find((e: any) => e.type === "review_submitted");
    expect(reviewEvent.actor).toBe("agent-a");
    expect(reviewEvent.summary).toContain("★");
  });

  it("events are sorted chronologically", async () => {
    const { matchId } = await createDealWithMessages();
    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const timestamps = json.events.map((e: any) => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("includes rejection events", async () => {
    const { matchId } = await createDealWithMessages();

    await db.execute({
      sql: `INSERT INTO approvals (match_id, agent_id, approved) VALUES (?, 'agent-b', 0)`,
      args: [matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const rejectionEvent = json.events.find((e: any) => e.type === "rejection");
    expect(rejectionEvent).toBeDefined();
    expect(rejectionEvent.actor).toBe("agent-b");
    expect(rejectionEvent.summary).toContain("rejected");
  });

  it("includes resolved dispute events", async () => {
    const { matchId } = await createDealWithMessages();
    const disputeId = uuid();

    await db.execute({
      sql: `INSERT INTO disputes (id, match_id, filed_by_agent_id, reason, status, resolution_note, resolved_by, resolved_at)
            VALUES (?, ?, 'agent-a', 'Issue', 'resolved_complete', 'Fixed it', 'agent-b', datetime('now'))`,
      args: [disputeId, matchId],
    });

    const { GET } = await import("@/app/api/deals/[matchId]/timeline/route");
    const req = new Request(`http://localhost/api/deals/${matchId}/timeline`);
    const res = await GET(req as any, { params: Promise.resolve({ matchId }) });
    const json = await res.json();

    const types = json.events.map((e: any) => e.type);
    expect(types).toContain("dispute_filed");
    expect(types).toContain("dispute_resolved");

    const resolvedEvent = json.events.find((e: any) => e.type === "dispute_resolved");
    expect(resolvedEvent.summary).toContain("resolved_complete");
    expect(resolvedEvent.detail).toContain("Fixed it");
  });
});
