import type { Client } from "@libsql/client";
import { createNotification } from "./notifications";

export interface ExpiryConfig {
  /** Hours after which a deal in negotiating/matched status auto-expires. Default 168 (7 days). */
  timeoutHours: number;
  /** Maximum deals to expire in one sweep. Default 100. */
  limit: number;
}

export interface ExpiredDeal {
  id: string;
  status: string;
  created_at: string;
  agent_a_id: string;
  agent_b_id: string;
  hours_stale: number;
}

export interface ExpiryResult {
  expired_count: number;
  expired_deals: ExpiredDeal[];
  timeout_hours: number;
  swept_at: string;
}

const DEFAULT_TIMEOUT_HOURS = 168; // 7 days
const DEFAULT_LIMIT = 100;
const MAX_TIMEOUT_HOURS = 8760; // 1 year
const MIN_TIMEOUT_HOURS = 1;

export function validateExpiryConfig(timeoutHours?: number, limit?: number): ExpiryConfig {
  const t = timeoutHours ?? DEFAULT_TIMEOUT_HOURS;
  const l = limit ?? DEFAULT_LIMIT;

  if (t < MIN_TIMEOUT_HOURS || t > MAX_TIMEOUT_HOURS) {
    throw new Error(`timeout_hours must be between ${MIN_TIMEOUT_HOURS} and ${MAX_TIMEOUT_HOURS}`);
  }
  if (l < 1 || l > 500) {
    throw new Error("limit must be between 1 and 500");
  }

  return { timeoutHours: Math.floor(t), limit: Math.floor(l) };
}

/**
 * Find and expire deals stuck in matched/negotiating status beyond the timeout.
 * Returns the list of expired deals.
 */
export async function expireStaleDeals(
  db: Client,
  config: ExpiryConfig
): Promise<ExpiryResult> {
  const cutoff = new Date(Date.now() - config.timeoutHours * 60 * 60 * 1000).toISOString();

  // Find stale deals
  const staleResult = await db.execute({
    sql: `SELECT m.id, m.status, m.created_at,
            pa.agent_id as agent_a_id,
            pb.agent_id as agent_b_id,
            ROUND((julianday('now') - julianday(m.created_at)) * 24, 1) as hours_stale
          FROM matches m
          JOIN profiles pa ON m.profile_a_id = pa.id
          JOIN profiles pb ON m.profile_b_id = pb.id
          WHERE m.status IN ('matched', 'negotiating')
            AND m.created_at < ?
          ORDER BY m.created_at ASC
          LIMIT ?`,
    args: [cutoff, config.limit],
  });

  const staleDeal = staleResult.rows as unknown as Array<{
    id: string;
    status: string;
    created_at: string;
    agent_a_id: string;
    agent_b_id: string;
    hours_stale: number;
  }>;

  if (staleDeal.length === 0) {
    return {
      expired_count: 0,
      expired_deals: [],
      timeout_hours: config.timeoutHours,
      swept_at: new Date().toISOString(),
    };
  }

  const dealIds = staleDeal.map((d) => d.id);
  const placeholders = dealIds.map(() => "?").join(",");

  // Update status to expired
  await db.execute({
    sql: `UPDATE matches SET status = 'expired' WHERE id IN (${placeholders})`,
    args: dealIds,
  });

  // Send notifications to both parties
  for (const deal of staleDeal) {
    const summary = `Deal auto-expired after ${config.timeoutHours}h of inactivity (was ${deal.status})`;

    await createNotification(db, {
      agent_id: deal.agent_a_id,
      type: "deal_expired",
      summary,
      from_agent_id: deal.agent_b_id,
      match_id: deal.id,
    });

    if (deal.agent_a_id !== deal.agent_b_id) {
      await createNotification(db, {
        agent_id: deal.agent_b_id,
        type: "deal_expired",
        summary,
        from_agent_id: deal.agent_a_id,
        match_id: deal.id,
      });
    }
  }

  const expiredDeals: ExpiredDeal[] = staleDeal.map((d) => ({
    id: d.id,
    status: d.status,
    created_at: d.created_at,
    agent_a_id: d.agent_a_id,
    agent_b_id: d.agent_b_id,
    hours_stale: Number(d.hours_stale),
  }));

  return {
    expired_count: expiredDeals.length,
    expired_deals: expiredDeals,
    timeout_hours: config.timeoutHours,
    swept_at: new Date().toISOString(),
  };
}

/**
 * Preview stale deals without expiring them.
 */
export async function previewStaleDeals(
  db: Client,
  config: ExpiryConfig
): Promise<{ stale_count: number; stale_deals: ExpiredDeal[]; timeout_hours: number }> {
  const cutoff = new Date(Date.now() - config.timeoutHours * 60 * 60 * 1000).toISOString();

  const staleResult = await db.execute({
    sql: `SELECT m.id, m.status, m.created_at,
            pa.agent_id as agent_a_id,
            pb.agent_id as agent_b_id,
            ROUND((julianday('now') - julianday(m.created_at)) * 24, 1) as hours_stale
          FROM matches m
          JOIN profiles pa ON m.profile_a_id = pa.id
          JOIN profiles pb ON m.profile_b_id = pb.id
          WHERE m.status IN ('matched', 'negotiating')
            AND m.created_at < ?
          ORDER BY m.created_at ASC
          LIMIT ?`,
    args: [cutoff, config.limit],
  });

  const staleDeal = staleResult.rows as unknown as Array<{
    id: string;
    status: string;
    created_at: string;
    agent_a_id: string;
    agent_b_id: string;
    hours_stale: number;
  }>;

  return {
    stale_count: staleDeal.length,
    stale_deals: staleDeal.map((d) => ({
      id: d.id,
      status: d.status,
      created_at: d.created_at,
      agent_a_id: d.agent_a_id,
      agent_b_id: d.agent_b_id,
      hours_stale: Number(d.hours_stale),
    })),
    timeout_hours: config.timeoutHours,
  };
}
