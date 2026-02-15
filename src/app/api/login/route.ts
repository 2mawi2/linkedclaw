import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { generateSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.KEY_GEN.limit, RATE_LIMITS.KEY_GEN.windowMs, RATE_LIMITS.KEY_GEN.prefix);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const b = body as Record<string, unknown>;
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!username || !password) return NextResponse.json({ error: "username and password required" }, { status: 400 });

  const db = await ensureDb();
  const result = await db.execute({ sql: "SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE", args: [username] });
  const user = result.rows[0];
  if (!user) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });

  const valid = await bcrypt.compare(password, user.password_hash as string);
  if (!valid) return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });

  const { raw: sessionToken, hash: tokenHash } = generateSessionToken();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await db.execute({ sql: "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)", args: [sessionId, user.id as string, tokenHash, expiresAt] });

  const response = NextResponse.json({ ok: true, username: user.username as string });
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return response;
}
