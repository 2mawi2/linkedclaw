import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, migrate, _setDb } from "@/lib/db";
import type { Client } from "@libsql/client";
import { randomUUID } from "crypto";

let db: Client;
let restore: () => void;

async function createUser(db: Client, username: string) {
  const userId = randomUUID();
  const apiKey = `lc_${randomUUID().replace(/-/g, "")}`;
  await db.execute({
    sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    args: [userId, username, "hash"],
  });
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)",
    args: [randomUUID(), username, userId, apiKey],
  });
  return { userId, apiKey, agentId: username };
}

async function createMatchInProgress(db: Client, agentA: string, agentB: string) {
  const profileAId = randomUUID();
  const profileBId = randomUUID();
  const matchId = randomUUID();

  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'offering', 'dev', '{}')",
    args: [profileAId, agentA],
  });
  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'seeking', 'dev', '{}')",
    args: [profileBId, agentB],
  });
  await db.execute({
    sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, '{}', 'in_progress')",
    args: [matchId, profileAId, profileBId],
  });

  return { matchId, profileAId, profileBId };
}

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
});

describe("Dispute table schema", () => {
  it("should create disputes table", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='disputes'",
    );
    expect(result.rows.length).toBe(1);
  });

  it("should insert and retrieve a dispute", async () => {
    const id = randomUUID();
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");
    await db.execute({
      sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
      args: [id, matchId, "agent-a", "Work not delivered"],
    });

    const result = await db.execute({
      sql: "SELECT * FROM disputes WHERE id = ?",
      args: [id],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].status).toBe("open");
    expect(result.rows[0].reason).toBe("Work not delivered");
    expect(result.rows[0].resolved_at).toBeNull();
  });

  it("should enforce status check constraint", async () => {
    await expect(
      db.execute({
        sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason, status) VALUES (?, ?, ?, ?, ?)",
        args: [randomUUID(), randomUUID(), "agent-a", "reason", "invalid_status"],
      }),
    ).rejects.toThrow();
  });
});

describe("Dispute resolution flow", () => {
  it("should update dispute to resolved_complete", async () => {
    const id = randomUUID();
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");
    await db.execute({
      sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
      args: [id, matchId, "agent-a", "Issue"],
    });

    await db.execute({
      sql: "UPDATE disputes SET status = 'resolved_complete', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ?",
      args: ["agent-b", "Agreed to complete", id],
    });

    const result = await db.execute({
      sql: "SELECT * FROM disputes WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0].status).toBe("resolved_complete");
    expect(result.rows[0].resolved_by).toBe("agent-b");
    expect(result.rows[0].resolution_note).toBe("Agreed to complete");
    expect(result.rows[0].resolved_at).not.toBeNull();
  });

  it("should update dispute to resolved_refund", async () => {
    const id = randomUUID();
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");
    await db.execute({
      sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
      args: [id, matchId, "agent-a", "Issue"],
    });
    await db.execute({
      sql: "UPDATE disputes SET status = 'resolved_refund' WHERE id = ?",
      args: [id],
    });
    const result = await db.execute({
      sql: "SELECT status FROM disputes WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0].status).toBe("resolved_refund");
  });

  it("should update dispute to resolved_split", async () => {
    const id = randomUUID();
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");
    await db.execute({
      sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
      args: [id, matchId, "agent-a", "Issue"],
    });
    await db.execute({
      sql: "UPDATE disputes SET status = 'resolved_split' WHERE id = ?",
      args: [id],
    });
    const result = await db.execute({
      sql: "SELECT status FROM disputes WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0].status).toBe("resolved_split");
  });

  it("should update dispute to dismissed", async () => {
    const id = randomUUID();
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");
    await db.execute({
      sql: "INSERT INTO disputes (id, match_id, filed_by_agent_id, reason) VALUES (?, ?, ?, ?)",
      args: [id, matchId, "agent-a", "Issue"],
    });
    await db.execute({
      sql: "UPDATE disputes SET status = 'dismissed' WHERE id = ?",
      args: [id],
    });
    const result = await db.execute({
      sql: "SELECT status FROM disputes WHERE id = ?",
      args: [id],
    });
    expect(result.rows[0].status).toBe("dismissed");
  });
});

describe("Match disputed status", () => {
  it("should allow disputed status on matches", async () => {
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");

    await db.execute({
      sql: "UPDATE matches SET status = 'disputed' WHERE id = ?",
      args: [matchId],
    });

    const result = await db.execute({
      sql: "SELECT status FROM matches WHERE id = ?",
      args: [matchId],
    });
    expect(result.rows[0].status).toBe("disputed");
  });

  it("should allow transitioning back from disputed to in_progress (dismiss)", async () => {
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");

    await db.execute({
      sql: "UPDATE matches SET status = 'disputed' WHERE id = ?",
      args: [matchId],
    });
    await db.execute({
      sql: "UPDATE matches SET status = 'in_progress' WHERE id = ?",
      args: [matchId],
    });

    const result = await db.execute({
      sql: "SELECT status FROM matches WHERE id = ?",
      args: [matchId],
    });
    expect(result.rows[0].status).toBe("in_progress");
  });

  it("should allow transitioning from disputed to completed (resolved_complete)", async () => {
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");

    await db.execute({
      sql: "UPDATE matches SET status = 'disputed' WHERE id = ?",
      args: [matchId],
    });
    await db.execute({
      sql: "UPDATE matches SET status = 'completed' WHERE id = ?",
      args: [matchId],
    });

    const result = await db.execute({
      sql: "SELECT status FROM matches WHERE id = ?",
      args: [matchId],
    });
    expect(result.rows[0].status).toBe("completed");
  });

  it("should allow transitioning from disputed to cancelled (resolved_refund)", async () => {
    const { matchId } = await createMatchInProgress(db, "agent-a", "agent-b");

    await db.execute({
      sql: "UPDATE matches SET status = 'disputed' WHERE id = ?",
      args: [matchId],
    });
    await db.execute({
      sql: "UPDATE matches SET status = 'cancelled' WHERE id = ?",
      args: [matchId],
    });

    const result = await db.execute({
      sql: "SELECT status FROM matches WHERE id = ?",
      args: [matchId],
    });
    expect(result.rows[0].status).toBe("cancelled");
  });
});

describe("Dispute index", () => {
  it("should have index on match_id", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_disputes_match'",
    );
    expect(result.rows.length).toBe(1);
  });

  it("should have index on filed_by_agent_id", async () => {
    const result = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_disputes_agent'",
    );
    expect(result.rows.length).toBe(1);
  });
});
