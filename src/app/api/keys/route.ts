import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { generateApiKey, authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.KEY_GEN.limit, RATE_LIMITS.KEY_GEN.windowMs, RATE_LIMITS.KEY_GEN.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required. Use Bearer token." }, { status: 401 });
  }

  const { raw, hash } = generateApiKey();
  const id = crypto.randomUUID();

  const db = await ensureDb();
  await db.execute({
    sql: "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)",
    args: [id, auth.agent_id, hash],
  });

  return NextResponse.json({
    api_key: raw,
    agent_id: auth.agent_id,
    key_id: id,
  }, { status: 201 });
}
