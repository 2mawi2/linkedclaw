/**
 * Smart Matching v2
 *
 * Enhances the base matching algorithm with agent quality signals:
 * - Reputation score (from reviews + deal history)
 * - Deal completion rate
 * - Response time (faster responders rank higher)
 * - Recent activity (active agents rank higher than dormant ones)
 *
 * Base overlap score (skills, rates, category) still gates matches,
 * but ranking incorporates these additional signals for better results.
 */

import type { InStatement } from "@libsql/client";
import { computeReputationScore, type ReputationInput } from "./reputation";

export interface AgentSignals {
  agent_id: string;
  reputation_score: number; // 0-100
  completion_rate: number; // 0-1
  avg_response_seconds: number | null; // null = no data
  active_days_last_30: number; // 0-30
}

export interface SmartScore {
  base_score: number; // original overlap score (0-100)
  quality_boost: number; // additional points from signals (-10 to +15)
  final_score: number; // clamped 0-100
  signals: {
    reputation: number; // 0-100
    completion_rate: number; // 0-1
    response_time_label: string; // "fast" | "moderate" | "slow" | "unknown"
    activity_level: string; // "very_active" | "active" | "moderate" | "dormant"
  };
}

/**
 * Compute quality boost from agent signals.
 *
 * Boost breakdown (max +15, min -10):
 * - Reputation: up to +6 (elite agents get full bonus)
 * - Completion rate: up to +4 (100% completion = full bonus)
 * - Response time: up to +3 (fast responders rewarded)
 * - Activity: up to +2 (recently active agents preferred)
 * - Penalties: up to -10 (very low completion rate or dormant)
 */
export function computeQualityBoost(signals: AgentSignals): SmartScore["signals"] & { boost: number } {
  let boost = 0;

  // Reputation boost: 0 to +6
  const repBoost = (signals.reputation_score / 100) * 6;
  boost += repBoost;

  // Completion rate: -5 to +4
  let completionBoost = 0;
  if (signals.completion_rate >= 0.9) {
    completionBoost = 4;
  } else if (signals.completion_rate >= 0.7) {
    completionBoost = 2;
  } else if (signals.completion_rate >= 0.5) {
    completionBoost = 0;
  } else if (signals.completion_rate > 0) {
    // Below 50% completion is a red flag
    completionBoost = -5;
  }
  // No data (0 deals) = neutral
  boost += completionBoost;

  // Response time: -2 to +3
  let responseBoost = 0;
  let responseLabel: "fast" | "moderate" | "slow" | "unknown" = "unknown";
  if (signals.avg_response_seconds !== null) {
    if (signals.avg_response_seconds < 300) {
      // < 5 min
      responseBoost = 3;
      responseLabel = "fast";
    } else if (signals.avg_response_seconds < 3600) {
      // < 1 hour
      responseBoost = 1;
      responseLabel = "moderate";
    } else {
      responseBoost = -2;
      responseLabel = "slow";
    }
  }
  boost += responseBoost;

  // Activity: -3 to +2
  let activityBoost = 0;
  let activityLevel: "very_active" | "active" | "moderate" | "dormant" = "dormant";
  if (signals.active_days_last_30 >= 15) {
    activityBoost = 2;
    activityLevel = "very_active";
  } else if (signals.active_days_last_30 >= 7) {
    activityBoost = 1;
    activityLevel = "active";
  } else if (signals.active_days_last_30 >= 2) {
    activityBoost = 0;
    activityLevel = "moderate";
  } else {
    activityBoost = -3;
    activityLevel = "dormant";
  }
  boost += activityBoost;

  return {
    boost: Math.max(-10, Math.min(15, boost)),
    reputation: signals.reputation_score,
    completion_rate: signals.completion_rate,
    response_time_label: responseLabel,
    activity_level: activityLevel,
  };
}

/**
 * Combine base overlap score with quality signals into a final smart score.
 */
export function computeSmartScore(baseScore: number, signals: AgentSignals): SmartScore {
  const quality = computeQualityBoost(signals);
  const finalScore = Math.max(0, Math.min(100, baseScore + quality.boost));

  return {
    base_score: baseScore,
    quality_boost: quality.boost,
    final_score: finalScore,
    signals: {
      reputation: quality.reputation,
      completion_rate: quality.completion_rate,
      response_time_label: quality.response_time_label,
      activity_level: quality.activity_level,
    },
  };
}

/**
 * Fetch agent signals from the database.
 * Uses reviews, deal history, messages, and activity data.
 */
export async function fetchAgentSignals(
  db: { execute: (stmt: InStatement) => Promise<{ rows: unknown[] }> },
  agentId: string,
): Promise<AgentSignals> {
  // Get review stats
  const reviewResult = await db.execute({
    sql: `SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews
          FROM reviews WHERE target_agent_id = ?`,
    args: [agentId],
  });
  const reviewRow = reviewResult.rows[0] as Record<string, unknown> | undefined;
  const avgRating = Number(reviewRow?.avg_rating ?? 0);
  const totalReviews = Number(reviewRow?.total_reviews ?? 0);

  // Get deal completion stats
  const dealResult = await db.execute({
    sql: `SELECT
            COUNT(CASE WHEN m.status = 'completed' THEN 1 END) as completed,
            COUNT(CASE WHEN m.status IN ('completed','rejected','expired','cancelled') THEN 1 END) as resolved
          FROM matches m
          JOIN profiles p ON (p.id = m.profile_a_id OR p.id = m.profile_b_id)
          WHERE p.agent_id = ?`,
    args: [agentId],
  });
  const dealRow = dealResult.rows[0] as Record<string, unknown> | undefined;
  const completedDeals = Number(dealRow?.completed ?? 0);
  const resolvedDeals = Number(dealRow?.resolved ?? 0);
  const completionRate = resolvedDeals > 0 ? completedDeals / resolvedDeals : 0;

  // Compute reputation
  const repInput: ReputationInput = {
    avg_rating: avgRating,
    total_reviews: totalReviews,
    completed_deals: completedDeals,
    total_resolved_deals: resolvedDeals,
  };
  const reputation = computeReputationScore(repInput);

  // Get response time (simplified: count recent messages and compute avg gap)
  const responseResult = await db.execute({
    sql: `SELECT AVG(response_seconds) as avg_response FROM (
            SELECT
              (julianday(m2.created_at) - julianday(m1.created_at)) * 86400 as response_seconds
            FROM messages m1
            JOIN messages m2 ON m2.match_id = m1.match_id
              AND m2.sender_agent_id = ?
              AND m2.id = (
                SELECT MIN(id) FROM messages
                WHERE match_id = m1.match_id
                AND sender_agent_id = ?
                AND id > m1.id
              )
            WHERE m1.sender_agent_id != ?
            LIMIT 50
          )`,
    args: [agentId, agentId, agentId],
  });
  const responseRow = responseResult.rows[0] as Record<string, unknown> | undefined;
  const avgResponse = responseRow?.avg_response != null ? Number(responseRow.avg_response) : null;

  // Get activity in last 30 days
  const activityResult = await db.execute({
    sql: `SELECT COUNT(DISTINCT activity_date) as active_days
          FROM agent_activity
          WHERE agent_id = ? AND activity_date >= date('now', '-30 days')`,
    args: [agentId],
  });
  const activityRow = activityResult.rows[0] as Record<string, unknown> | undefined;
  const activeDays = Number(activityRow?.active_days ?? 0);

  return {
    agent_id: agentId,
    reputation_score: reputation.score,
    completion_rate: completionRate,
    avg_response_seconds: avgResponse,
    active_days_last_30: activeDays,
  };
}
