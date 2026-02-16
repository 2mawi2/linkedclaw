import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiKey } from "@/__tests__/test-helpers";
import { createTestDb, _setDb, migrate } from "@/lib/db";
import type { Client } from "@libsql/client";
import { GET } from "@/app/api/activity/streaks/route";
import { POST } from "@/app/api/activity/record/route";
import { NextRequest } from "next/server";
import { computeStreaks } from "@/lib/activity-streaks";

let db: Client;
let restore: () => void;
let aliceKey: string;

beforeEach(async () => {
  db = createTestDb();
  restore = _setDb(db);
  await migrate(db);
  aliceKey = await createApiKey("alice");
});

afterEach(() => {
  restore();
});

function jsonReq(
  url: string,
  opts?: { body?: unknown; apiKey?: string; method?: string },
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts?.body) headers["Content-Type"] = "application/json";
  if (opts?.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  const method = opts?.method ?? (opts?.body ? "POST" : "GET");
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
    headers,
  });
}

describe("Activity Streaks API", () => {
  describe("POST /api/activity/record", () => {
    it("requires authentication", async () => {
      const res = await POST(jsonReq("/api/activity/record", { body: { activity_type: "login" } }));
      expect(res.status).toBe(401);
    });

    it("rejects invalid activity_type", async () => {
      const res = await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "invalid" }, apiKey: aliceKey }),
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid activity_type");
    });

    it("rejects missing activity_type", async () => {
      const res = await POST(jsonReq("/api/activity/record", { body: {}, apiKey: aliceKey }));
      expect(res.status).toBe(400);
    });

    it("records a login activity", async () => {
      const res = await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "login" }, apiKey: aliceKey }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.activity_type).toBe("login");
    });

    it("records all valid activity types", async () => {
      const types = ["listing", "message", "deal", "proposal", "review", "login", "search"];
      for (const t of types) {
        const res = await POST(
          jsonReq("/api/activity/record", { body: { activity_type: t }, apiKey: aliceKey }),
        );
        expect(res.status).toBe(200);
      }
    });

    it("increments count on duplicate day+type", async () => {
      await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "login" }, apiKey: aliceKey }),
      );
      await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "login" }, apiKey: aliceKey }),
      );

      // Verify via streaks endpoint
      const res = await GET(jsonReq("/api/activity/streaks", { apiKey: aliceKey }));
      const data = await res.json();
      expect(data.history.length).toBe(1);
      expect(data.history[0].types.login).toBe(2);
    });
  });

  describe("GET /api/activity/streaks", () => {
    it("requires authentication", async () => {
      const res = await GET(jsonReq("/api/activity/streaks"));
      expect(res.status).toBe(401);
    });

    it("returns empty streaks for new agent", async () => {
      const res = await GET(jsonReq("/api/activity/streaks", { apiKey: aliceKey }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.agent_id).toBe("alice");
      expect(data.streaks.current_streak).toBe(0);
      expect(data.streaks.longest_streak).toBe(0);
      expect(data.streaks.total_active_days).toBe(0);
      expect(data.streaks.badges).toEqual([]);
      expect(data.history).toEqual([]);
    });

    it("returns streak data after recording activity", async () => {
      await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "login" }, apiKey: aliceKey }),
      );
      const res = await GET(jsonReq("/api/activity/streaks", { apiKey: aliceKey }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.streaks.current_streak).toBeGreaterThanOrEqual(1);
      expect(data.streaks.total_active_days).toBe(1);
      expect(data.history.length).toBe(1);
    });

    it("respects history_days parameter", async () => {
      await POST(
        jsonReq("/api/activity/record", { body: { activity_type: "login" }, apiKey: aliceKey }),
      );
      const res = await GET(jsonReq("/api/activity/streaks?history_days=1", { apiKey: aliceKey }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.history.length).toBeLessThanOrEqual(1);
    });

    it("clamps history_days to valid range", async () => {
      const res = await GET(
        jsonReq("/api/activity/streaks?history_days=999", { apiKey: aliceKey }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("computeStreaks (unit)", () => {
    it("returns zeros for empty dates", () => {
      const result = computeStreaks([], "2026-02-16");
      expect(result.current_streak).toBe(0);
      expect(result.longest_streak).toBe(0);
      expect(result.total_active_days).toBe(0);
      expect(result.last_active_date).toBeNull();
    });

    it("computes 1-day streak for today", () => {
      const result = computeStreaks(["2026-02-16"], "2026-02-16");
      expect(result.current_streak).toBe(1);
      expect(result.longest_streak).toBe(1);
      expect(result.total_active_days).toBe(1);
    });

    it("computes 1-day streak for yesterday", () => {
      const result = computeStreaks(["2026-02-15"], "2026-02-16");
      expect(result.current_streak).toBe(1);
      expect(result.longest_streak).toBe(1);
    });

    it("current streak is 0 if last active 2+ days ago", () => {
      const result = computeStreaks(["2026-02-14"], "2026-02-16");
      expect(result.current_streak).toBe(0);
      expect(result.longest_streak).toBe(1);
    });

    it("computes multi-day streak", () => {
      const dates = ["2026-02-13", "2026-02-14", "2026-02-15", "2026-02-16"];
      const result = computeStreaks(dates, "2026-02-16");
      expect(result.current_streak).toBe(4);
      expect(result.longest_streak).toBe(4);
    });

    it("computes longest streak separate from current", () => {
      const dates = [
        "2026-02-01",
        "2026-02-02",
        "2026-02-03",
        "2026-02-04",
        "2026-02-05",
        "2026-02-16",
      ];
      const result = computeStreaks(dates, "2026-02-16");
      expect(result.current_streak).toBe(1);
      expect(result.longest_streak).toBe(5);
    });

    it("awards streak badges at thresholds", () => {
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date("2026-02-10T00:00:00Z");
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
      const result = computeStreaks(dates, "2026-02-16");
      expect(result.badges.some((b) => b.id === "streak_3")).toBe(true);
      expect(result.badges.some((b) => b.id === "streak_7")).toBe(true);
    });

    it("awards total active days badges", () => {
      const dates: string[] = [];
      for (let i = 0; i < 10; i++) {
        // spread out so no streak, just total days
        const d = new Date("2026-01-01T00:00:00Z");
        d.setDate(d.getDate() + i * 3);
        dates.push(d.toISOString().slice(0, 10));
      }
      const result = computeStreaks(dates, "2026-02-16");
      expect(result.total_active_days).toBe(10);
      expect(result.badges.some((b) => b.id === "active_10")).toBe(true);
    });
  });
});
