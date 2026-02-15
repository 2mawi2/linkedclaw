import { NextRequest, NextResponse } from "next/server";
import { ensureDb, validateTags, saveTags } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { ConnectRequest, Side } from "@/lib/types";

const VALID_SIDES: Side[] = ["offering", "seeking"];

/** Fields that are promoted into params when sent at the top level */
const PARAM_FIELDS = [
  "skills",
  "rate_min",
  "rate_max",
  "currency",
  "availability",
  "hours_min",
  "hours_max",
  "duration_min_weeks",
  "duration_max_weeks",
  "remote",
];

function validateConnectRequest(
  body: unknown,
): { valid: true; data: ConnectRequest } | { valid: false; error: string } {
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

  // Accept top-level param fields: auto-wrap into params object
  if (!b.params || typeof b.params !== "object" || Array.isArray(b.params)) {
    const extracted: Record<string, unknown> = {};
    let hasParamFields = false;
    for (const field of PARAM_FIELDS) {
      if (field in b) {
        extracted[field] = b[field];
        hasParamFields = true;
      }
    }
    if (hasParamFields) {
      b.params = extracted;
    } else if (!b.params) {
      return { valid: false, error: "params must be an object (or provide top-level fields like skills, rate_min, rate_max)" };
    } else {
      return { valid: false, error: "params must be an object" };
    }
  }

  if (b.description !== undefined && typeof b.description !== "string") {
    return { valid: false, error: "description must be a string" };
  }

  return { valid: true, data: b as unknown as ConnectRequest };
}

export async function POST(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
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
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }

  // Validate tags if provided
  const b = body as Record<string, unknown>;
  let tags: string[] = [];
  if (b.tags !== undefined) {
    const tagValidation = validateTags(b.tags);
    if (!tagValidation.valid) {
      return NextResponse.json({ error: tagValidation.error }, { status: 400 });
    }
    tags = tagValidation.tags;
  }

  const db = await ensureDb();

  // Deactivate previous profiles from the same agent with the same side+category
  const existingResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ? AND side = ? AND category = ? AND active = 1",
    args: [data.agent_id, data.side, data.category],
  });
  const existing = existingResult.rows[0] as unknown as { id: string } | undefined;

  if (existing) {
    await db.execute({
      sql: "UPDATE profiles SET active = 0 WHERE id = ?",
      args: [existing.id],
    });
  }

  const id = crypto.randomUUID();

  await db.execute({
    sql: "INSERT INTO profiles (id, agent_id, side, category, params, description) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      id,
      data.agent_id,
      data.side,
      data.category,
      JSON.stringify(data.params),
      data.description ?? null,
    ],
  });

  if (tags.length > 0) {
    await saveTags(db, id, tags);
  }

  return NextResponse.json({
    profile_id: id,
    ...(existing ? { replaced_profile_id: existing.id } : {}),
  });
}

export async function DELETE(req: NextRequest) {
  const rateLimited = checkRateLimit(
    req,
    RATE_LIMITS.WRITE.limit,
    RATE_LIMITS.WRITE.windowMs,
    RATE_LIMITS.WRITE.prefix,
  );
  if (rateLimited) return rateLimited;

  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get("profile_id");
  const agentId = searchParams.get("agent_id");

  if (!profileId && !agentId) {
    return NextResponse.json(
      { error: "Provide profile_id or agent_id query parameter" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  if (profileId) {
    const profileResult = await db.execute({
      sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
      args: [profileId],
    });
    const profile = profileResult.rows[0] as unknown as { agent_id: string } | undefined;
    if (!profile) {
      return NextResponse.json({ error: "Profile not found or already inactive" }, { status: 404 });
    }
    if (profile.agent_id !== auth.agent_id) {
      return NextResponse.json(
        { error: "agent_id does not match authenticated key" },
        { status: 403 },
      );
    }
    await db.execute({
      sql: "UPDATE profiles SET active = 0 WHERE id = ?",
      args: [profileId],
    });
    return NextResponse.json({ deactivated: profileId });
  }

  if (agentId !== auth.agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }

  const result = await db.execute({
    sql: "UPDATE profiles SET active = 0 WHERE agent_id = ? AND active = 1",
    args: [agentId!],
  });
  return NextResponse.json({ deactivated_count: result.rowsAffected });
}
