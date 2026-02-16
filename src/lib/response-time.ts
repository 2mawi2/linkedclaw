/**
 * Response time tracking for agents.
 *
 * Computes average response time by looking at consecutive messages in deals
 * where the sender changes. The time between the previous message and the
 * agent's reply is the response time for that exchange.
 */

import type { Client } from "@libsql/client";

export interface ResponseTimeStats {
  /** Average response time in seconds, or null if no data */
  avg_seconds: number | null;
  /** Human-readable label like "< 1 min", "5 min", "2 hrs" */
  label: string;
  /** Number of response samples used */
  sample_count: number;
}

/**
 * Compute avg response time for an agent across all their deals.
 *
 * Looks at consecutive message pairs in each deal where the previous message
 * was from a different agent and this agent replied. The delta is one sample.
 */
export async function computeResponseTime(
  db: Client,
  agentId: string,
): Promise<ResponseTimeStats> {
  // Get all messages from deals this agent is involved in, ordered by deal + time
  const result = await db.execute({
    sql: `
      SELECT m.match_id, m.sender_agent_id, m.created_at
      FROM messages m
      JOIN matches mt ON mt.id = m.match_id
      JOIN profiles pa ON pa.id = mt.profile_a_id
      JOIN profiles pb ON pb.id = mt.profile_b_id
      WHERE (pa.agent_id = ? OR pb.agent_id = ?)
        AND m.message_type != 'system'
      ORDER BY m.match_id, m.created_at ASC
    `,
    args: [agentId, agentId],
  });

  if (result.rows.length === 0) {
    return { avg_seconds: null, label: "N/A", sample_count: 0 };
  }

  const rows = result.rows as unknown as Array<{
    match_id: string;
    sender_agent_id: string;
    created_at: string;
  }>;

  let totalSeconds = 0;
  let sampleCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];

    // Must be same deal, different sender, and current sender is our agent
    if (
      curr.match_id === prev.match_id &&
      curr.sender_agent_id === agentId &&
      prev.sender_agent_id !== agentId
    ) {
      const prevTime = new Date(prev.created_at).getTime();
      const currTime = new Date(curr.created_at).getTime();
      const deltaMs = currTime - prevTime;

      // Only count positive deltas under 7 days (filter outliers)
      if (deltaMs > 0 && deltaMs < 7 * 24 * 60 * 60 * 1000) {
        totalSeconds += deltaMs / 1000;
        sampleCount++;
      }
    }
  }

  if (sampleCount === 0) {
    return { avg_seconds: null, label: "N/A", sample_count: 0 };
  }

  const avgSeconds = Math.round(totalSeconds / sampleCount);
  return {
    avg_seconds: avgSeconds,
    label: formatResponseTime(avgSeconds),
    sample_count: sampleCount,
  };
}

/** Format seconds into a human-readable response time label */
export function formatResponseTime(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins} min${mins !== 1 ? "s" : ""}`;
  }
  if (seconds < 86400) {
    const hrs = Math.round(seconds / 3600);
    return `${hrs} hr${hrs !== 1 ? "s" : ""}`;
  }
  const days = Math.round(seconds / 86400);
  return `${days} day${days !== 1 ? "s" : ""}`;
}
