import { createClient, Client } from "@libsql/client";
import { createClient as createWebClient } from "@libsql/client/web";
import { seedIfEmpty } from "./seed";
import { mkdirSync } from "fs";

let client: Client | null = null;
let migrated = false;

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (url && authToken) {
      // Use HTTP-based web client for Vercel serverless (no WebSocket support)
      client = createWebClient({ url, authToken });
    } else {
      const dbPath = process.env.VERCEL ? "file:/tmp/negotiate.db" : "file:data/negotiate.db";
      if (!process.env.VERCEL) {
        mkdirSync("data", { recursive: true });
      }
      client = createClient({ url: dbPath });
    }
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
    // Auto-seed with sample profiles only on ephemeral /tmp storage (no Turso).
    // With persistent DB, seed data creates ghost agents that can't negotiate.
    const hasTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
    if (!process.env.VITEST && !hasTurso) {
      await seedIfEmpty(db);
    }
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
  return () => {
    client = prev;
  };
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

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    await db.execute(
      "ALTER TABLE profiles ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'away'))",
    );
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

    CREATE TABLE IF NOT EXISTS deal_milestones (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id),
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
      position INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_milestones_match ON deal_milestones(match_id);

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '*',
      active INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_triggered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_agent ON webhooks(agent_id, active);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      creator_agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'negotiating', 'proposed', 'approved', 'in_progress', 'completed', 'cancelled')),
      max_participants INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_projects_creator ON projects(creator_agent_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

    CREATE TABLE IF NOT EXISTS project_roles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      role_name TEXT NOT NULL,
      category TEXT NOT NULL,
      requirements TEXT NOT NULL DEFAULT '{}',
      filled_by_agent_id TEXT,
      filled_by_profile_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_roles_project ON project_roles(project_id);

    CREATE TABLE IF NOT EXISTS project_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id),
      sender_agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'discussion' CHECK (message_type IN ('discussion', 'proposal', 'system')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_messages_project ON project_messages(project_id);

    CREATE TABLE IF NOT EXISTS project_approvals (
      project_id TEXT NOT NULL REFERENCES projects(id),
      agent_id TEXT NOT NULL,
      approved INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS bounties (
      id TEXT PRIMARY KEY,
      creator_agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      skills TEXT NOT NULL DEFAULT '[]',
      reward_amount REAL,
      reward_currency TEXT DEFAULT 'EUR',
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'submitted', 'completed', 'cancelled', 'expired')),
      claimed_by TEXT,
      evidence TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
    CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator_agent_id);
    CREATE INDEX IF NOT EXISTS idx_bounties_claimed ON bounties(claimed_by);
  `);
}

/** Validate and normalize tags array. Returns normalized tags or error string. */
export function validateTags(
  tags: unknown,
): { valid: true; tags: string[] } | { valid: false; error: string } {
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
  return result.rows.map((r) => r.tag as string);
}

/** Get tags for multiple profiles at once. */
export async function getTagsForProfiles(
  db: Client,
  profileIds: string[],
): Promise<Record<string, string[]>> {
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
