import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const VALID_TIMEZONES_PATTERN = /^[A-Za-z_]+\/[A-Za-z_]+$/;
const BOOLEAN_FIELDS = [
  "notify_new_matches",
  "notify_messages",
  "notify_deal_updates",
  "notify_listing_expiry",
  "notify_digest",
  "auto_accept_deals",
] as const;

interface PreferencesRow {
  agent_id: string;
  timezone: string;
  notify_new_matches: number;
  notify_messages: number;
  notify_deal_updates: number;
  notify_listing_expiry: number;
  notify_digest: number;
  auto_accept_deals: number;
  auto_accept_max_rate: number | null;
  auto_accept_categories: string | null;
  updated_at: string;
}

function formatPreferences(row: PreferencesRow) {
  return {
    timezone: row.timezone,
    notifications: {
      new_matches: !!row.notify_new_matches,
      messages: !!row.notify_messages,
      deal_updates: !!row.notify_deal_updates,
      listing_expiry: !!row.notify_listing_expiry,
      digest: !!row.notify_digest,
    },
    auto_accept: {
      enabled: !!row.auto_accept_deals,
      max_rate: row.auto_accept_max_rate,
      categories: row.auto_accept_categories
        ? JSON.parse(row.auto_accept_categories)
        : null,
    },
    updated_at: row.updated_at,
  };
}

/**
 * GET /api/preferences - Get current agent's preferences
 */
export async function GET(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.READ.limit,
    RATE_LIMITS.READ.windowMs,
    RATE_LIMITS.READ.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT * FROM agent_preferences WHERE agent_id = ?",
    args: [auth.agent_id],
  });

  if (result.rows.length === 0) {
    // Return defaults
    return NextResponse.json(
      formatPreferences({
        agent_id: auth.agent_id,
        timezone: "UTC",
        notify_new_matches: 1,
        notify_messages: 1,
        notify_deal_updates: 1,
        notify_listing_expiry: 1,
        notify_digest: 1,
        auto_accept_deals: 0,
        auto_accept_max_rate: null,
        auto_accept_categories: null,
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      }),
    );
  }

  return NextResponse.json(formatPreferences(result.rows[0] as unknown as PreferencesRow));
}

/**
 * PUT /api/preferences - Update agent preferences
 *
 * Body (all fields optional):
 * - timezone: string (e.g. "America/New_York")
 * - notifications: { new_matches, messages, deal_updates, listing_expiry, digest } (booleans)
 * - auto_accept: { enabled, max_rate, categories }
 */
export async function PUT(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate timezone
  const timezone = body.timezone as string | undefined;
  if (timezone !== undefined) {
    if (typeof timezone !== "string" || (!VALID_TIMEZONES_PATTERN.test(timezone) && timezone !== "UTC")) {
      return NextResponse.json(
        { error: "Invalid timezone. Use IANA format (e.g. 'America/New_York') or 'UTC'." },
        { status: 400 },
      );
    }
  }

  // Validate notifications
  const notifications = body.notifications as Record<string, unknown> | undefined;
  if (notifications !== undefined && (typeof notifications !== "object" || notifications === null)) {
    return NextResponse.json({ error: "notifications must be an object" }, { status: 400 });
  }

  // Validate auto_accept
  const autoAccept = body.auto_accept as Record<string, unknown> | undefined;
  if (autoAccept !== undefined) {
    if (typeof autoAccept !== "object" || autoAccept === null) {
      return NextResponse.json({ error: "auto_accept must be an object" }, { status: 400 });
    }
    if (autoAccept.max_rate !== undefined && autoAccept.max_rate !== null) {
      if (typeof autoAccept.max_rate !== "number" || autoAccept.max_rate < 0) {
        return NextResponse.json({ error: "auto_accept.max_rate must be a non-negative number" }, { status: 400 });
      }
    }
    if (autoAccept.categories !== undefined && autoAccept.categories !== null) {
      if (!Array.isArray(autoAccept.categories) || !autoAccept.categories.every((c: unknown) => typeof c === "string")) {
        return NextResponse.json({ error: "auto_accept.categories must be an array of strings" }, { status: 400 });
      }
    }
  }

  const db = await ensureDb();

  // Build upsert
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const fields: Record<string, unknown> = { updated_at: now };

  if (timezone !== undefined) fields.timezone = timezone;
  if (notifications) {
    if (notifications.new_matches !== undefined) fields.notify_new_matches = notifications.new_matches ? 1 : 0;
    if (notifications.messages !== undefined) fields.notify_messages = notifications.messages ? 1 : 0;
    if (notifications.deal_updates !== undefined) fields.notify_deal_updates = notifications.deal_updates ? 1 : 0;
    if (notifications.listing_expiry !== undefined) fields.notify_listing_expiry = notifications.listing_expiry ? 1 : 0;
    if (notifications.digest !== undefined) fields.notify_digest = notifications.digest ? 1 : 0;
  }
  if (autoAccept) {
    if (autoAccept.enabled !== undefined) fields.auto_accept_deals = autoAccept.enabled ? 1 : 0;
    if (autoAccept.max_rate !== undefined) fields.auto_accept_max_rate = autoAccept.max_rate;
    if (autoAccept.categories !== undefined) {
      fields.auto_accept_categories = autoAccept.categories ? JSON.stringify(autoAccept.categories) : null;
    }
  }

  // Check if preferences exist
  const existing = await db.execute({
    sql: "SELECT agent_id FROM agent_preferences WHERE agent_id = ?",
    args: [auth.agent_id],
  });

  if (existing.rows.length === 0) {
    // Insert with defaults + overrides
    const allFields = {
      agent_id: auth.agent_id,
      timezone: "UTC",
      notify_new_matches: 1,
      notify_messages: 1,
      notify_deal_updates: 1,
      notify_listing_expiry: 1,
      notify_digest: 1,
      auto_accept_deals: 0,
      auto_accept_max_rate: null,
      auto_accept_categories: null,
      updated_at: now,
      ...fields,
    };
    const cols = Object.keys(allFields);
    const placeholders = cols.map(() => "?").join(", ");
    await db.execute({
      sql: `INSERT INTO agent_preferences (${cols.join(", ")}) VALUES (${placeholders})`,
      args: Object.values(allFields) as (string | number | null)[],
    });
  } else {
    // Update only provided fields
    const setClauses = Object.keys(fields).map((k) => `${k} = ?`);
    const values = Object.values(fields) as (string | number | null)[];
    await db.execute({
      sql: `UPDATE agent_preferences SET ${setClauses.join(", ")} WHERE agent_id = ?`,
      args: [...values, auth.agent_id],
    });
  }

  // Return updated preferences
  const updated = await db.execute({
    sql: "SELECT * FROM agent_preferences WHERE agent_id = ?",
    args: [auth.agent_id],
  });

  return NextResponse.json(formatPreferences(updated.rows[0] as unknown as PreferencesRow));
}
