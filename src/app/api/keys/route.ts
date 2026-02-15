import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.KEY_GEN.limit, RATE_LIMITS.KEY_GEN.windowMs, RATE_LIMITS.KEY_GEN.prefix);
  if (rateLimited) return rateLimited;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string" || b.agent_id.trim().length === 0) {
    return NextResponse.json({ error: "agent_id is required and must be a non-empty string" }, { status: 400 });
  }

  const agentId = b.agent_id.trim();
  const { raw, hash } = generateApiKey();
  const id = crypto.randomUUID();

  const db = getDb();
  db.prepare(
    "INSERT INTO api_keys (id, agent_id, key_hash) VALUES (?, ?, ?)"
  ).run(id, agentId, hash);

  return NextResponse.json({
    api_key: raw,
    agent_id: agentId,
    key_id: id,
  });
}
