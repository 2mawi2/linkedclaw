import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { createHash } from "crypto";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function authenticateRequest(req: NextRequest): { agent_id: string } | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(lc_.+)$/);
  if (!match) return null;

  const rawKey = match[1];
  const hashed = hashKey(rawKey);

  const db = getDb();
  const row = db.prepare("SELECT agent_id FROM api_keys WHERE key = ?").get(hashed) as
    | { agent_id: string }
    | undefined;

  if (!row) return null;

  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key = ?").run(hashed);

  return { agent_id: row.agent_id };
}
