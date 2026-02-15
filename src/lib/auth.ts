import { createHash, randomBytes } from "crypto";
import { ensureDb } from "@/lib/db";
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

export async function authenticateRequest(req: NextRequest): Promise<AuthResult | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const rawKey = match[1];
  const keyHash = hashApiKey(rawKey);

  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT id, agent_id FROM api_keys WHERE key_hash = ?",
    args: [keyHash],
  });
  const row = result.rows[0];

  if (!row) return null;

  await db.execute({
    sql: "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?",
    args: [row.id as string],
  });

  return { agent_id: row.agent_id as string, key_id: row.id as string };
}
