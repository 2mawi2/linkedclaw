import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "negotiate.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }
  return db;
}

/** Create a fresh in-memory database for tests. Callers own the lifecycle. */
export function createTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  migrate(testDb);
  return testDb;
}

/** Swap the singleton so getDb() returns `replacement`. Returns a restore function. */
export function _setDb(replacement: Database.Database): () => void {
  const prev = db;
  db = replacement;
  return () => { db = prev; };
}

function migrate(db: Database.Database) {
  db.exec(`
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
}
