import type { Client } from "@libsql/client";
import { createNotification } from "./notifications";

/** Default listing lifetime in days */
export const LISTING_LIFETIME_DAYS = 30;

/** Days before expiry to send a warning notification */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * Expire stale listings: deactivate profiles whose expires_at is in the past.
 * Returns the number of listings expired.
 */
export async function expireStaleListings(db: Client): Promise<number> {
  const now = new Date().toISOString();

  // Find profiles about to expire (for notifications)
  const expired = await db.execute({
    sql: "SELECT id, agent_id, category, side FROM profiles WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?",
    args: [now],
  });

  if (expired.rows.length === 0) return 0;

  // Deactivate expired listings
  await db.execute({
    sql: "UPDATE profiles SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?",
    args: [now],
  });

  // Notify each agent
  for (const row of expired.rows) {
    await createNotification(db, {
      agent_id: row.agent_id as string,
      type: "listing_expired",
      summary: `Your ${row.side} listing in "${row.category}" has expired. Renew it to stay visible.`,
    });
  }

  return expired.rows.length;
}

/**
 * Find listings expiring within the next N days.
 * Used for warning notifications and the "expiring soon" API.
 */
export async function getExpiringListings(
  db: Client,
  withinDays: number = EXPIRY_WARNING_DAYS,
): Promise<
  Array<{
    id: string;
    agent_id: string;
    category: string;
    side: string;
    expires_at: string;
    description: string | null;
  }>
> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: "SELECT id, agent_id, category, side, expires_at, description FROM profiles WHERE active = 1 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?",
    args: [now, cutoff],
  });

  return result.rows.map((r) => ({
    id: r.id as string,
    agent_id: r.agent_id as string,
    category: r.category as string,
    side: r.side as string,
    expires_at: r.expires_at as string,
    description: r.description as string | null,
  }));
}

/**
 * Renew a listing: extend expires_at by LISTING_LIFETIME_DAYS from now.
 * Can also reactivate an expired (inactive) listing.
 * Returns the new expires_at timestamp.
 */
export async function renewListing(
  db: Client,
  profileId: string,
  agentId: string,
): Promise<{ renewed: boolean; expires_at: string; reactivated: boolean; error?: string }> {
  // Find the profile (active or recently expired)
  const result = await db.execute({
    sql: "SELECT id, agent_id, active FROM profiles WHERE id = ?",
    args: [profileId],
  });

  const profile = result.rows[0];
  if (!profile) {
    return { renewed: false, expires_at: "", reactivated: false, error: "Profile not found" };
  }

  if ((profile.agent_id as string) !== agentId) {
    return {
      renewed: false,
      expires_at: "",
      reactivated: false,
      error: "Not authorized to renew this profile",
    };
  }

  const newExpiry = new Date(
    Date.now() + LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const wasInactive = !(profile.active as number);

  await db.execute({
    sql: "UPDATE profiles SET expires_at = ?, active = 1 WHERE id = ?",
    args: [newExpiry, profileId],
  });

  return { renewed: true, expires_at: newExpiry, reactivated: wasInactive };
}
