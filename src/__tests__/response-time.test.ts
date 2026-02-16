import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { formatResponseTime, computeResponseTime } from "@/lib/response-time";

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

describe("Response Time", () => {
  describe("formatResponseTime", () => {
    it("under 1 minute", () => {
      expect(formatResponseTime(0)).toBe("< 1 min");
      expect(formatResponseTime(30)).toBe("< 1 min");
      expect(formatResponseTime(59)).toBe("< 1 min");
    });

    it("minutes", () => {
      expect(formatResponseTime(60)).toBe("1 min");
      expect(formatResponseTime(300)).toBe("5 mins");
      expect(formatResponseTime(3599)).toBe("60 mins");
    });

    it("hours", () => {
      expect(formatResponseTime(3600)).toBe("1 hr");
      expect(formatResponseTime(7200)).toBe("2 hrs");
      expect(formatResponseTime(43200)).toBe("12 hrs");
    });

    it("days", () => {
      expect(formatResponseTime(86400)).toBe("1 day");
      expect(formatResponseTime(172800)).toBe("2 days");
    });
  });

  describe("computeResponseTime", () => {
    it("returns N/A for agent with no messages", async () => {
      const result = await computeResponseTime(db, "nonexistent-agent");
      expect(result.avg_seconds).toBeNull();
      expect(result.label).toBe("N/A");
      expect(result.sample_count).toBe(0);
    });

    it("computes average from message pairs", async () => {
      // Create two agents with profiles and a match
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-a", "rt-agent-a", "offering", "development", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-b", "rt-agent-b", "seeking", "development", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-1", "rt-prof-a", "rt-prof-b", "test overlap", "negotiating"],
      });

      // Agent B sends, Agent A replies 5 minutes later
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-1", "rt-agent-b", "Hello!", "2026-01-01T10:00:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-1", "rt-agent-a", "Hi there!", "2026-01-01T10:05:00"],
      });

      // Agent B sends again, Agent A replies 10 minutes later
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-1", "rt-agent-b", "Interested?", "2026-01-01T10:10:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-1", "rt-agent-a", "Yes!", "2026-01-01T10:20:00"],
      });

      const result = await computeResponseTime(db, "rt-agent-a");
      // avg of 300s and 600s = 450s
      expect(result.avg_seconds).toBe(450);
      expect(result.sample_count).toBe(2);
      expect(result.label).toBe("8 mins");
    });

    it("ignores system messages", async () => {
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-c", "rt-agent-c", "offering", "design", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-d", "rt-agent-d", "seeking", "design", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-2", "rt-prof-c", "rt-prof-d", "design overlap", "negotiating"],
      });

      // System message should not count
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, message_type, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-2", "system", "Deal started", "system", "2026-01-01T10:00:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-2", "rt-agent-c", "Hello!", "2026-01-01T10:05:00"],
      });

      const result = await computeResponseTime(db, "rt-agent-c");
      expect(result.sample_count).toBe(0);
      expect(result.avg_seconds).toBeNull();
    });

    it("handles multiple deals", async () => {
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-e", "rt-agent-e", "offering", "writing", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-f", "rt-agent-f", "seeking", "writing", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-g", "rt-agent-g", "seeking", "writing", "{}"],
      });

      // Deal 1: agent-f -> agent-e, 2 min reply
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-3", "rt-prof-e", "rt-prof-f", "overlap", "negotiating"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-3", "rt-agent-f", "Hi", "2026-01-01T10:00:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-3", "rt-agent-e", "Hey", "2026-01-01T10:02:00"],
      });

      // Deal 2: agent-g -> agent-e, 8 min reply
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-4", "rt-prof-e", "rt-prof-g", "overlap", "negotiating"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-4", "rt-agent-g", "Hello", "2026-01-01T11:00:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-4", "rt-agent-e", "Hi there", "2026-01-01T11:08:00"],
      });

      const result = await computeResponseTime(db, "rt-agent-e");
      // avg of 120s and 480s = 300s
      expect(result.avg_seconds).toBe(300);
      expect(result.sample_count).toBe(2);
      expect(result.label).toBe("5 mins");
    });

    it("skips outliers over 7 days", async () => {
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-h", "rt-agent-h", "offering", "marketing", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-i", "rt-agent-i", "seeking", "marketing", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-5", "rt-prof-h", "rt-prof-i", "overlap", "negotiating"],
      });

      // 10-day gap - should be filtered out
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-5", "rt-agent-i", "Hey", "2026-01-01T10:00:00"],
      });
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-5", "rt-agent-h", "Sorry for the delay", "2026-01-11T10:00:00"],
      });

      const result = await computeResponseTime(db, "rt-agent-h");
      expect(result.sample_count).toBe(0);
      expect(result.avg_seconds).toBeNull();
    });

    it("only counts replies, not initiations", async () => {
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-j", "rt-agent-j", "offering", "dev", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO profiles (id, agent_id, side, category, params) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-prof-k", "rt-agent-k", "seeking", "dev", "{}"],
      });
      await db.execute({
        sql: `INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status) VALUES (?, ?, ?, ?, ?)`,
        args: ["rt-match-6", "rt-prof-j", "rt-prof-k", "overlap", "negotiating"],
      });

      // Agent J sends first (initiation, not a reply)
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-6", "rt-agent-j", "Hey!", "2026-01-01T10:00:00"],
      });
      // Agent J sends again (consecutive, not a reply to K)
      await db.execute({
        sql: `INSERT INTO messages (match_id, sender_agent_id, content, created_at) VALUES (?, ?, ?, ?)`,
        args: ["rt-match-6", "rt-agent-j", "Anyone there?", "2026-01-01T10:05:00"],
      });

      const result = await computeResponseTime(db, "rt-agent-j");
      expect(result.sample_count).toBe(0);
    });
  });
});
