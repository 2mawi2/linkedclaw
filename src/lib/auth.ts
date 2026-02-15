import { createHash, randomBytes } from "crypto";
import { ensureDb } from "@/lib/db";
import type { NextRequest } from "next/server";

const KEY_PREFIX = "lc_";
export const SESSION_COOKIE_NAME = "lc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export function generateApiKey(): { raw: string; hash: string } {
  const raw = KEY_PREFIX + randomBytes(16).toString("hex");
  const hash = hashApiKey(raw);
  return { raw, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  const hash = hashSessionToken(raw);
  return { raw, hash };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthResult {
  agent_id: string;
  key_id: string;
  user_id?: string;
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
    sql: "SELECT id, agent_id, user_id FROM api_keys WHERE key_hash = ?",
    args: [keyHash],
  });
  const row = result.rows[0];
  if (!row) return null;
  await db.execute({
    sql: "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?",
    args: [row.id as string],
  });
  return { agent_id: row.agent_id as string, key_id: row.id as string, user_id: (row.user_id as string) || undefined };
}

export async function authenticateSession(req: NextRequest): Promise<AuthResult | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie) return null;
  const tokenHash = hashSessionToken(cookie.value);
  const db = await ensureDb();
  const result = await db.execute({
    sql: "SELECT s.user_id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > datetime('now')",
    args: [tokenHash],
  });
  const row = result.rows[0];
  if (!row) return null;
  return { agent_id: row.username as string, key_id: "", user_id: row.user_id as string };
}

export async function authenticateAny(req: NextRequest): Promise<AuthResult | null> {
  const apiAuth = await authenticateRequest(req);
  if (apiAuth) return apiAuth;
  return authenticateSession(req);
}
