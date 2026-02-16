import { describe, test, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db";
import { migrate } from "@/lib/db";
import type { Client } from "@libsql/client";

// We test the analytics query logic directly against a test DB
describe("Analytics API", () => {
  let db: Client;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
  });

  test("returns empty analytics on fresh DB", async () => {
    const totals = await db.execute(`
      SELECT
        COUNT(*) as total_deals,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status IN ('matched', 'negotiating', 'proposed', 'in_progress') THEN 1 ELSE 0 END) as active
      FROM matches
    `);
    const row = totals.rows[0] as unknown as Record<string, number>;
    expect(Number(row.total_deals)).toBe(0);
    expect(Number(row.completed || 0)).toBe(0);
    expect(Number(row.active || 0)).toBe(0);
  });

  test("counts deals by status correctly", async () => {
    // Create profiles
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "agent-a", "offering", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p2", "agent-b", "seeking", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p3", "agent-c", "seeking", "design", "{}"],
    });

    // Create matches
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m1", "p1", "p2", "react", "completed"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m2", "p1", "p3", "ui", "negotiating"],
    });

    const result = await db.execute(`
      SELECT status, COUNT(*) as count
      FROM matches
      GROUP BY status
      ORDER BY count DESC
    `);

    expect(result.rows.length).toBe(2);
    const statusMap: Record<string, number> = {};
    for (const row of result.rows) {
      const r = row as unknown as { status: string; count: number };
      statusMap[r.status] = Number(r.count);
    }
    expect(statusMap.completed).toBe(1);
    expect(statusMap.negotiating).toBe(1);
  });

  test("computes category breakdown from deals", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "agent-a", "offering", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p2", "agent-b", "seeking", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p3", "agent-c", "offering", "design", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p4", "agent-d", "seeking", "design", "{}"],
    });

    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m1", "p1", "p2", "react", "completed"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m2", "p3", "p4", "figma", "negotiating"],
    });

    const result = await db.execute(`
      SELECT p.category, COUNT(DISTINCT m.id) as deal_count
      FROM matches m
      JOIN profiles p ON p.id = m.profile_a_id
      GROUP BY p.category
      ORDER BY deal_count DESC
    `);

    expect(result.rows.length).toBe(2);
    const rows = result.rows as unknown as Array<{ category: string; deal_count: number }>;
    // Both have 1 deal each
    expect(Number(rows[0].deal_count)).toBe(1);
    expect(Number(rows[1].deal_count)).toBe(1);
  });

  test("computes top agents by completed deals", async () => {
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p1", "agent-a", "offering", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p2", "agent-b", "seeking", "development", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p3", "agent-a", "offering", "design", "{}"],
    });
    await db.execute({
      sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
      args: ["p4", "agent-c", "seeking", "design", "{}"],
    });

    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m1", "p1", "p2", "react", "completed"],
    });
    await db.execute({
      sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
      args: ["m2", "p3", "p4", "figma", "approved"],
    });

    const result = await db.execute(`
      SELECT agent_id, COUNT(*) as completed_deals
      FROM (
        SELECT p.agent_id
        FROM matches m
        JOIN profiles p ON p.id = m.profile_a_id
        WHERE m.status IN ('completed', 'approved')
        UNION ALL
        SELECT p.agent_id
        FROM matches m
        JOIN profiles p ON p.id = m.profile_b_id
        WHERE m.status IN ('completed', 'approved')
      )
      GROUP BY agent_id
      ORDER BY completed_deals DESC
    `);

    expect(result.rows.length).toBe(3);
    const rows = result.rows as unknown as Array<{ agent_id: string; completed_deals: number }>;
    // agent-a appears in both deals (via p1 and p3), so has 2
    expect(rows[0].agent_id).toBe("agent-a");
    expect(Number(rows[0].completed_deals)).toBe(2);
    // agent-b and agent-c each have 1
    expect(Number(rows[1].completed_deals)).toBe(1);
    expect(Number(rows[2].completed_deals)).toBe(1);
  });

  test("bounty stats query works with no bounties", async () => {
    const result = await db.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        AVG(budget_max) as avg_budget
      FROM bounties
    `);

    const row = result.rows[0] as unknown as Record<string, number | null>;
    expect(Number(row.total)).toBe(0);
    expect(row.avg_budget).toBeNull();
  });

  test("bounty stats count correctly", async () => {
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, category, skills, status, budget_min, budget_max, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["b1", "agent-a", "Build API", "development", '["Node.js"]', "open", 500, 1000, "USD"],
    });
    await db.execute({
      sql: `INSERT INTO bounties (id, creator_agent_id, title, category, skills, status, budget_min, budget_max, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["b2", "agent-b", "Design Logo", "design", '["Figma"]', "completed", 200, 500, "USD"],
    });

    const result = await db.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        AVG(budget_max) as avg_budget
      FROM bounties
    `);

    const row = result.rows[0] as unknown as Record<string, number | null>;
    expect(Number(row.total)).toBe(2);
    expect(Number(row.open)).toBe(1);
    expect(Number(row.completed)).toBe(1);
    expect(Number(row.avg_budget)).toBe(750);
  });
});
