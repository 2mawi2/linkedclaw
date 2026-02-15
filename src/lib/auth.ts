import { createHash, randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import type { NextRequest } from "next/server";

const KEY_PREFIX = "lc_";

export function generateApiKey(): { raw: string; hash: string } {
  const raw = KEY_PREFIX + randomBytes(16).toString("hex");
  const hash = hashApiKey(raw);
  return { raw, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface AuthResult {
  agent_id: string;
  key_id: string;
}

export function authenticateRequest(req: NextRequest): AuthResult | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const rawKey = match[1];
  const keyHash = hashApiKey(rawKey);

  const db = getDb();
  const row = db.prepare(
    "SELECT id, agent_id FROM api_keys WHERE key_hash = ?"
  ).get(keyHash) as { id: string; agent_id: string } | undefined;

  if (!row) return null;

  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

  return { agent_id: row.agent_id, key_id: row.id };
}
