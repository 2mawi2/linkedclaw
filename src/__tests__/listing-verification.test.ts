import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb, migrate } from "@/lib/db";
import { getVerifiedAgentIds, isAgentVerified } from "@/lib/badges";
import type { Client } from "@libsql/client";

describe("Listing verification", () => {
  let db: Client;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
  });

  async function createProfile(id: string, agentId: string) {
    await db.execute({
      sql: "INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, 'offering', 'freelance-dev', '{}')",
      args: [id, agentId],
    });
  }

  async function createMatch(id: string, profileA: string, profileB: string, status: string) {
    await db.execute({
      sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, 'test', ?)",
      args: [id, profileA, profileB, status],
    });
  }

  it("returns empty set when no agents provided", async () => {
    const result = await getVerifiedAgentIds(db, []);
    expect(result.size).toBe(0);
  });

  it("returns empty set when agent has no deals", async () => {
    await createProfile("p1", "agent1");
    const result = await getVerifiedAgentIds(db, ["agent1"]);
    expect(result.has("agent1")).toBe(false);
  });

  it("returns empty set when agent has only matched (not completed) deals", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "matched");
    const result = await getVerifiedAgentIds(db, ["agent1"]);
    expect(result.has("agent1")).toBe(false);
  });

  it("returns agent when they have a completed deal", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "completed");
    const result = await getVerifiedAgentIds(db, ["agent1"]);
    expect(result.has("agent1")).toBe(true);
  });

  it("verifies both sides of a completed deal", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "completed");
    const result = await getVerifiedAgentIds(db, ["agent1", "agent2"]);
    expect(result.has("agent1")).toBe(true);
    expect(result.has("agent2")).toBe(true);
  });

  it("does not verify agents with only negotiating status", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "negotiating");
    const result = await getVerifiedAgentIds(db, ["agent1"]);
    expect(result.has("agent1")).toBe(false);
  });

  it("does not verify agents with only rejected deals", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "rejected");
    const result = await getVerifiedAgentIds(db, ["agent1"]);
    expect(result.has("agent1")).toBe(false);
  });

  it("handles duplicate agent IDs gracefully", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "completed");
    const result = await getVerifiedAgentIds(db, ["agent1", "agent1", "agent1"]);
    expect(result.has("agent1")).toBe(true);
  });

  it("isAgentVerified returns true for verified agent", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createMatch("m1", "p1", "p2", "completed");
    expect(await isAgentVerified(db, "agent1")).toBe(true);
  });

  it("isAgentVerified returns false for unverified agent", async () => {
    await createProfile("p1", "agent1");
    expect(await isAgentVerified(db, "agent1")).toBe(false);
  });

  it("handles mix of verified and unverified agents", async () => {
    await createProfile("p1", "agent1");
    await createProfile("p2", "agent2");
    await createProfile("p3", "agent3");
    await createMatch("m1", "p1", "p2", "completed");
    // agent3 has no completed deals
    const result = await getVerifiedAgentIds(db, ["agent1", "agent2", "agent3"]);
    expect(result.has("agent1")).toBe(true);
    expect(result.has("agent2")).toBe(true);
    expect(result.has("agent3")).toBe(false);
  });
});
