import { NextRequest, NextResponse } from "next/server";
import { ensureDb, validateTags, saveTags, getTagsForProfile } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/profiles/:profileId - Get a single profile by ID
 * PATCH /api/profiles/:profileId - Update a profile's params, description, or tags
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await params;
  const db = await ensureDb();

  const result = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [profileId],
  });
  const profile = result.rows[0] as unknown as Profile | undefined;

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const profileParams: ProfileParams = JSON.parse(profile.params);
  const tags = await getTagsForProfile(db, profile.id);
  return NextResponse.json({
    id: profile.id,
    agent_id: profile.agent_id,
    side: profile.side,
    category: profile.category,
    params: profileParams,
    description: profile.description,
    active: !!profile.active,
    tags,
    created_at: profile.created_at,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const rateLimited = checkRateLimit(req, RATE_LIMITS.WRITE.limit, RATE_LIMITS.WRITE.windowMs, RATE_LIMITS.WRITE.prefix);
  if (rateLimited) return rateLimited;

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId } = await params;

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

  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required for authorization" }, { status: 400 });
  }

  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json({ error: "agent_id does not match authenticated key" }, { status: 403 });
  }

  const db = await ensureDb();
  const profileResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
    args: [profileId],
  });
  const profile = profileResult.rows[0] as unknown as Profile | undefined;

  if (!profile) {
    return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });
  }

  if (profile.agent_id !== b.agent_id) {
    return NextResponse.json({ error: "Not authorized to update this profile" }, { status: 403 });
  }

  // Merge params if provided
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (b.params && typeof b.params === "object" && !Array.isArray(b.params)) {
    const existingParams: ProfileParams = JSON.parse(profile.params);
    const merged = { ...existingParams, ...b.params as ProfileParams };
    updates.push("params = ?");
    values.push(JSON.stringify(merged));
  }

  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") {
      return NextResponse.json({ error: "description must be a string or null" }, { status: 400 });
    }
    updates.push("description = ?");
    values.push(b.description as string | null);
  }

  // Handle tags
  let newTags: string[] | undefined;
  if (b.tags !== undefined) {
    const tagValidation = validateTags(b.tags);
    if (!tagValidation.valid) {
      return NextResponse.json({ error: tagValidation.error }, { status: 400 });
    }
    newTags = tagValidation.tags;
  }

  if (updates.length === 0 && newTags === undefined) {
    return NextResponse.json({ error: "No fields to update. Provide params, description, or tags." }, { status: 400 });
  }

  if (updates.length > 0) {
    values.push(profileId);
    await db.execute({
      sql: `UPDATE profiles SET ${updates.join(", ")} WHERE id = ?`,
      args: values,
    });
  }

  if (newTags !== undefined) {
    await saveTags(db, profileId, newTags);
  }

  // Return updated profile
  const updatedResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ?",
    args: [profileId],
  });
  const updated = updatedResult.rows[0] as unknown as Profile;
  const updatedParams: ProfileParams = JSON.parse(updated.params);
  const updatedTags = await getTagsForProfile(db, profileId);

  return NextResponse.json({
    id: updated.id,
    agent_id: updated.agent_id,
    side: updated.side,
    category: updated.category,
    params: updatedParams,
    description: updated.description,
    active: !!updated.active,
    tags: updatedTags,
    created_at: updated.created_at,
  });
}
