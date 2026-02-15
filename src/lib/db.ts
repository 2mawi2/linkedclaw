import { createClient, Client } from "@libsql/client";

let client: Client | null = null;
let migrated = false;

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || (process.env.VERCEL ? "file:/tmp/negotiate.db" : "file:data/negotiate.db"),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

/**
 * Get the DB client with migrations applied. Safe to call repeatedly.
 * Use in API routes to ensure DB schema exists (critical for Vercel ephemeral /tmp).
 */
export async function ensureDb(): Promise<Client> {
  const db = getDb();
  if (!migrated) {
    await migrate(db);
    migrated = true;
  }
  return db;
}

/** Create a fresh in-memory database for tests. Callers own the lifecycle. */
export function createTestDb(): Client {
  return createClient({ url: ":memory:" });
}

/** Swap the singleton so getDb() returns `replacement`. Returns a restore function. */
export function _setDb(replacement: Client): () => void {
  const prev = client;
  client = replacement;
  return () => { client = prev; };
}

/** Run schema migrations. Must be called before using the database. */
export async function migrate(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('offering', 'seeking')),
      category TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      profile_a_id TEXT NOT NULL REFERENCES profiles(id),
      profile_b_id TEXT NOT NULL REFERENCES profiles(id),
      overlap_summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'negotiating', 'proposed', 'approved', 'in_progress', 'completed', 'rejected', 'expired', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(profile_a_id, profile_b_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL REFERENCES matches(id),
      sender_agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'negotiation' CHECK (message_type IN ('negotiation', 'proposal', 'system')),
      proposed_terms TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL REFERENCES matches(id),
      agent_id TEXT NOT NULL,
      approved INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
  `);

  // Add expires_at column to matches (idempotent)
  try {
    await db.execute("ALTER TABLE matches ADD COLUMN expires_at TEXT");
  } catch {
    // Column already exists – ignore
  }

  // Deal templates table
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS deal_templates (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      side TEXT NOT NULL CHECK (side IN ('offering', 'seeking')),
      suggested_params TEXT NOT NULL DEFAULT '{}',
      suggested_terms TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Notifications table
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      match_id TEXT,
      from_agent_id TEXT,
      summary TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(agent_id, read);
  `);

  // Profile tags table
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS profile_tags (
      profile_id TEXT NOT NULL REFERENCES profiles(id),
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (profile_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_profile_tags_tag ON profile_tags(tag);
  `);

  // Add availability column to profiles
  try {
    await db.execute("ALTER TABLE profiles ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'away'))");
  } catch {
    // Column already exists
  }

  // Reviews table for agent reputation
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id),
      reviewer_agent_id TEXT NOT NULL,
      reviewed_agent_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, reviewer_agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_agent ON reviews(reviewed_agent_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_agent ON reviews(reviewer_agent_id);

    CREATE TABLE IF NOT EXISTS deal_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL REFERENCES matches(id),
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, agent_id)
    );
  `);
}

/** Validate and normalize tags array. Returns normalized tags or error string. */
export function validateTags(tags: unknown): { valid: true; tags: string[] } | { valid: false; error: string } {
  if (!Array.isArray(tags)) {
    return { valid: false, error: "tags must be an array" };
  }
  if (tags.length > 10) {
    return { valid: false, error: "Maximum 10 tags per profile" };
  }
  const normalized: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") {
      return { valid: false, error: "Each tag must be a string" };
    }
    const t = tag.trim().toLowerCase();
    if (t.length === 0) continue;
    if (t.length > 30) {
      return { valid: false, error: `Tag "${t}" exceeds 30 characters` };
    }
    if (!normalized.includes(t)) normalized.push(t);
  }
  return { valid: true, tags: normalized };
}

/** Save tags for a profile (replaces existing tags). */
export async function saveTags(db: Client, profileId: string, tags: string[]): Promise<void> {
  await db.execute({ sql: "DELETE FROM profile_tags WHERE profile_id = ?", args: [profileId] });
  for (const tag of tags) {
    await db.execute({
      sql: "INSERT INTO profile_tags (profile_id, tag) VALUES (?, ?)",
      args: [profileId, tag],
    });
  }
}

/** Get tags for a profile. */
export async function getTagsForProfile(db: Client, profileId: string): Promise<string[]> {
  const result = await db.execute({
    sql: "SELECT tag FROM profile_tags WHERE profile_id = ? ORDER BY tag",
    args: [profileId],
  });
  return result.rows.map(r => r.tag as string);
}

/** Get tags for multiple profiles at once. */
export async function getTagsForProfiles(db: Client, profileIds: string[]): Promise<Record<string, string[]>> {
  if (profileIds.length === 0) return {};
  const placeholders = profileIds.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT profile_id, tag FROM profile_tags WHERE profile_id IN (${placeholders}) ORDER BY tag`,
    args: profileIds,
  });
  const map: Record<string, string[]> = {};
  for (const id of profileIds) map[id] = [];
  for (const row of result.rows) {
    const pid = row.profile_id as string;
    if (map[pid]) map[pid].push(row.tag as string);
  }
  return map;
}

/** Initialize the default singleton DB with migrations. */
export async function initDb(): Promise<void> {
  const db = getDb();
  await migrate(db);
}
