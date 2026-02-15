import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { withWriteRateLimit } from "@/lib/rate-limit";
import type { ConnectRequest, Side, Profile } from "@/lib/types";

const VALID_SIDES: Side[] = ["offering", "seeking"];

function validateConnectRequest(body: unknown): { valid: true; data: ConnectRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") return { valid: false, error: "Invalid request body" };
  const b = body as Record<string, unknown>;

  if (!b.agent_id || typeof b.agent_id !== "string" || b.agent_id.trim().length === 0) {
    return { valid: false, error: "agent_id is required and must be a non-empty string" };
  }
  if (!b.side || !VALID_SIDES.includes(b.side as Side)) {
    return { valid: false, error: "side must be 'offering' or 'seeking'" };
  }
  if (!b.category || typeof b.category !== "string" || b.category.trim().length === 0) {
    return { valid: false, error: "category is required and must be a non-empty string" };
  }
  if (!b.params || typeof b.params !== "object" || Array.isArray(b.params)) {
    return { valid: false, error: "params must be an object" };
  }
  if (b.description !== undefined && typeof b.description !== "string") {
    return { valid: false, error: "description must be a string" };
  }

  return { valid: true, data: b as unknown as ConnectRequest };
}

export async function POST(req: NextRequest) {
  const rateLimited = withWriteRateLimit(req);
  if (rateLimited) return rateLimited;

  const auth = authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateConnectRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;

  if (data.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }
  const db = getDb();

  // Deactivate previous profiles from the same agent with the same side+category
  const existing = db.prepare(
    "SELECT id FROM profiles WHERE agent_id = ? AND side = ? AND category = ? AND active = 1"
  ).get(data.agent_id, data.side, data.category) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE profiles SET active = 0 WHERE id = ?").run(existing.id);
  }

  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, data.agent_id, data.side, data.category, JSON.stringify(data.params), data.description ?? null);

  return NextResponse.json({
    profile_id: id,
    ...(existing ? { replaced_profile_id: existing.id } : {}),
  });
}

export async function DELETE(req: NextRequest) {
  const rateLimited = withWriteRateLimit(req);
  if (rateLimited) return rateLimited;

  const auth = authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get("profile_id");
  const agentId = searchParams.get("agent_id");

  if (!profileId && !agentId) {
    return NextResponse.json({ error: "Provide profile_id or agent_id query parameter" }, { status: 400 });
  }

  const db = getDb();

  if (profileId) {
    const profile = db.prepare("SELECT * FROM profiles WHERE id = ? AND active = 1").get(profileId) as Profile | undefined;
    if (!profile) {
      return NextResponse.json({ error: "Profile not found or already inactive" }, { status: 404 });
    }
    if (profile.agent_id !== auth.agent_id) {
      return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
    }
    db.prepare("UPDATE profiles SET active = 0 WHERE id = ?").run(profileId);
    return NextResponse.json({ deactivated: profileId });
  }

  if (agentId !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }

  const result = db.prepare("UPDATE profiles SET active = 0 WHERE agent_id = ? AND active = 1").run(agentId!);
  return NextResponse.json({ deactivated_count: result.changes });
}
