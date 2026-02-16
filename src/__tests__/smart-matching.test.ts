import { describe, it, expect } from "bun:test";
import { computeQualityBoost, computeSmartScore, type AgentSignals } from "@/lib/smart-matching";

describe("Smart Matching v2", () => {
  describe("computeQualityBoost", () => {
    it("gives maximum boost to elite agents", () => {
      const signals: AgentSignals = {
        agent_id: "elite-agent",
        reputation_score: 95,
        completion_rate: 1.0,
        avg_response_seconds: 120,
        active_days_last_30: 20,
      };
      const result = computeQualityBoost(signals);
      expect(result.boost).toBeGreaterThan(10);
      expect(result.boost).toBeLessThanOrEqual(15);
      expect(result.reputation).toBe(95);
      expect(result.completion_rate).toBe(1.0);
      expect(result.response_time_label).toBe("fast");
      expect(result.activity_level).toBe("very_active");
    });

    it("penalizes agents with low completion rate", () => {
      const signals: AgentSignals = {
        agent_id: "flaky-agent",
        reputation_score: 30,
        completion_rate: 0.3,
        avg_response_seconds: 7200,
        active_days_last_30: 1,
      };
      const result = computeQualityBoost(signals);
      expect(result.boost).toBeLessThan(0);
      expect(result.activity_level).toBe("dormant");
      expect(result.response_time_label).toBe("slow");
    });

    it("returns neutral boost for new agents with no data", () => {
      const signals: AgentSignals = {
        agent_id: "new-agent",
        reputation_score: 0,
        completion_rate: 0,
        avg_response_seconds: null,
        active_days_last_30: 0,
      };
      const result = computeQualityBoost(signals);
      // Only dormancy penalty (-3), no other penalties for zero data
      expect(result.boost).toBe(-3);
      expect(result.response_time_label).toBe("unknown");
      expect(result.activity_level).toBe("dormant");
    });

    it("rewards moderate response time", () => {
      const signals: AgentSignals = {
        agent_id: "moderate-agent",
        reputation_score: 50,
        completion_rate: 0.8,
        avg_response_seconds: 1800, // 30 min
        active_days_last_30: 10,
      };
      const result = computeQualityBoost(signals);
      expect(result.response_time_label).toBe("moderate");
      expect(result.activity_level).toBe("active");
      expect(result.boost).toBeGreaterThan(0);
    });

    it("clamps boost to max 15", () => {
      const signals: AgentSignals = {
        agent_id: "super-agent",
        reputation_score: 100,
        completion_rate: 1.0,
        avg_response_seconds: 10,
        active_days_last_30: 30,
      };
      const result = computeQualityBoost(signals);
      expect(result.boost).toBeLessThanOrEqual(15);
    });

    it("clamps boost to min -10", () => {
      const signals: AgentSignals = {
        agent_id: "terrible-agent",
        reputation_score: 0,
        completion_rate: 0.1,
        avg_response_seconds: 100000,
        active_days_last_30: 0,
      };
      const result = computeQualityBoost(signals);
      expect(result.boost).toBeGreaterThanOrEqual(-10);
    });
  });

  describe("computeSmartScore", () => {
    it("combines base score with quality boost", () => {
      const signals: AgentSignals = {
        agent_id: "good-agent",
        reputation_score: 80,
        completion_rate: 0.95,
        avg_response_seconds: 200,
        active_days_last_30: 12,
      };
      const result = computeSmartScore(70, signals);
      expect(result.base_score).toBe(70);
      expect(result.quality_boost).toBeGreaterThan(0);
      expect(result.final_score).toBeGreaterThan(70);
      expect(result.final_score).toBeLessThanOrEqual(100);
      expect(result.signals.reputation).toBe(80);
      expect(result.signals.completion_rate).toBe(0.95);
    });

    it("clamps final score to 0-100", () => {
      const highSignals: AgentSignals = {
        agent_id: "agent",
        reputation_score: 100,
        completion_rate: 1.0,
        avg_response_seconds: 10,
        active_days_last_30: 30,
      };
      const result = computeSmartScore(98, highSignals);
      expect(result.final_score).toBeLessThanOrEqual(100);

      const lowSignals: AgentSignals = {
        agent_id: "agent",
        reputation_score: 0,
        completion_rate: 0.1,
        avg_response_seconds: 100000,
        active_days_last_30: 0,
      };
      const lowResult = computeSmartScore(5, lowSignals);
      expect(lowResult.final_score).toBeGreaterThanOrEqual(0);
    });

    it("can lower score for bad agents", () => {
      const badSignals: AgentSignals = {
        agent_id: "bad-agent",
        reputation_score: 10,
        completion_rate: 0.2,
        avg_response_seconds: 50000,
        active_days_last_30: 0,
      };
      const result = computeSmartScore(50, badSignals);
      expect(result.quality_boost).toBeLessThan(0);
      expect(result.final_score).toBeLessThan(50);
    });

    it("differentiates agents with same base score", () => {
      const goodSignals: AgentSignals = {
        agent_id: "good",
        reputation_score: 90,
        completion_rate: 1.0,
        avg_response_seconds: 60,
        active_days_last_30: 25,
      };
      const badSignals: AgentSignals = {
        agent_id: "bad",
        reputation_score: 10,
        completion_rate: 0.3,
        avg_response_seconds: 10000,
        active_days_last_30: 0,
      };
      const goodResult = computeSmartScore(60, goodSignals);
      const badResult = computeSmartScore(60, badSignals);
      expect(goodResult.final_score).toBeGreaterThan(badResult.final_score);
    });

    it("includes signal labels in output", () => {
      const signals: AgentSignals = {
        agent_id: "agent",
        reputation_score: 50,
        completion_rate: 0.75,
        avg_response_seconds: 600,
        active_days_last_30: 5,
      };
      const result = computeSmartScore(50, signals);
      expect(["fast", "moderate", "slow", "unknown"]).toContain(result.signals.response_time_label);
      expect(["very_active", "active", "moderate", "dormant"]).toContain(
        result.signals.activity_level,
      );
    });
  });
});
