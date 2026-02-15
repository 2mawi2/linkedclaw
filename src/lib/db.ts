import { createClient, Client } from "@libsql/client";

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:data/negotiate.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
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
      status TEXT NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'negotiating', 'proposed', 'approved', 'rejected', 'expired')),
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
}

/** Initialize the default singleton DB with migrations. */
export async function initDb(): Promise<void> {
  const db = getDb();
  await migrate(db);
}
