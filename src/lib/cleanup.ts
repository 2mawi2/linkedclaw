import { getDb } from "./db";

/**
 * Expire matches whose expires_at has passed and are still in an active state.
 * Returns the number of deals marked as expired.
 */
export function cleanupExpiredDeals(): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE matches
    SET status = 'expired'
    WHERE expires_at < datetime('now')
      AND status NOT IN ('approved', 'rejected', 'expired')
  `).run();
  return result.changes;
}

/**
 * Deactivate profiles that have had no activity for `daysInactive` days.
 * Activity is defined as having created a profile, sent a message, or been
 * part of a match within the window.
 * Returns the number of profiles deactivated.
 */
export function cleanupInactiveProfiles(daysInactive: number): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const result = db.prepare(`
    UPDATE profiles
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
      )
  `).run(cutoff, cutoff, cutoff, cutoff);

  return result.changes;
}
