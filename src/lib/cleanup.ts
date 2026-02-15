import { ensureDb } from "./db";

/**
 * Expire matches whose expires_at has passed and are still in an active state.
 * Returns the number of deals marked as expired.
 */
export async function cleanupExpiredDeals(): Promise<number> {
  const db = await ensureDb();
  const result = await db.execute(
    `UPDATE matches
     SET status = 'expired'
     WHERE expires_at < datetime('now')
       AND status NOT IN ('approved', 'rejected', 'expired')`,
  );
  return result.rowsAffected;
}

/**
 * Deactivate profiles that have had no activity for `daysInactive` days.
 * Activity is defined as having created a profile, sent a message, or been
 * part of a match within the window.
 * Returns the number of profiles deactivated.
 */
export async function cleanupInactiveProfiles(daysInactive: number): Promise<number> {
  const db = await ensureDb();
  const cutoff = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const result = await db.execute({
    sql: `UPDATE profiles
          SET active = 0
          WHERE active = 1
            AND created_at < ?
            AND id NOT IN (
              SELECT DISTINCT profile_a_id FROM matches WHERE created_at >= ?
              UNION
              SELECT DISTINCT profile_b_id FROM matches WHERE created_at >= ?
            )
            AND agent_id NOT IN (
              SELECT DISTINCT sender_agent_id FROM messages WHERE created_at >= ?
            )`,
    args: [cutoff, cutoff, cutoff, cutoff],
  });

  return result.rowsAffected;
}
