import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomBytes } from "crypto";
import { hashKey } from "@/lib/auth";

export async function POST(req: NextRequest) {
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

  const rawKey = "lc_" + randomBytes(16).toString("hex");
  const hashed = hashKey(rawKey);

  const db = getDb();
  db.prepare("INSERT INTO api_keys (key, agent_id) VALUES (?, ?)").run(hashed, b.agent_id);

  return NextResponse.json({ api_key: rawKey, agent_id: b.agent_id });
}
