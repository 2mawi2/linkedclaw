import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.KEY_GEN.limit, RATE_LIMITS.KEY_GEN.windowMs, RATE_LIMITS.KEY_GEN.prefix);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const b = body as Record<string, unknown>;
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";

  if (!username || username.length < 3 || username.length > 30) return NextResponse.json({ error: "username must be 3-30 characters" }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return NextResponse.json({ error: "username must be alphanumeric (dashes/underscores allowed)" }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });

  const db = await ensureDb();
  const existing = await db.execute({ sql: "SELECT id FROM users WHERE username = ? COLLATE NOCASE", args: [username] });
  if (existing.rows.length > 0) return NextResponse.json({ error: "Username already taken" }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = crypto.randomUUID();
  const { raw: apiKey, hash: keyHash } = generateApiKey();
  const keyId = crypto.randomUUID();

  await db.execute({ sql: "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", args: [userId, username, passwordHash] });
  await db.execute({ sql: "INSERT INTO api_keys (id, agent_id, user_id, key_hash) VALUES (?, ?, ?, ?)", args: [keyId, username, userId, keyHash] });

  return NextResponse.json({ user_id: userId, username, api_key: apiKey, agent_id: username, message: "Account created. Use api_key as Bearer token for API access, or login for browser." }, { status: 201 });
}
