import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Profile, ProfileParams } from "@/lib/types";

/**
 * GET /api/profiles/:profileId - Get a single profile by ID
 * PATCH /api/profiles/:profileId - Update a profile's params or description
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const { profileId } = await params;
  const db = getDb();

  const profile = db.prepare(
    "SELECT * FROM profiles WHERE id = ?"
  ).get(profileId) as Profile | undefined;

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const profileParams: ProfileParams = JSON.parse(profile.params);
  return NextResponse.json({
    id: profile.id,
    agent_id: profile.agent_id,
    side: profile.side,
    category: profile.category,
    params: profileParams,
    description: profile.description,
    active: !!profile.active,
    created_at: profile.created_at,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
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

  const db = getDb();
  const profile = db.prepare(
    "SELECT * FROM profiles WHERE id = ? AND active = 1"
  ).get(profileId) as Profile | undefined;

  if (!profile) {
    return NextResponse.json({ error: "Profile not found or inactive" }, { status: 404 });
  }

  if (profile.agent_id !== b.agent_id) {
    return NextResponse.json({ error: "Not authorized to update this profile" }, { status: 403 });
  }

  // Merge params if provided
  const updates: string[] = [];
  const values: unknown[] = [];

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
    values.push(b.description);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update. Provide params or description." }, { status: 400 });
  }

  values.push(profileId);
  db.prepare(`UPDATE profiles SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  // Return updated profile
  const updated = db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as Profile;
  const updatedParams: ProfileParams = JSON.parse(updated.params);

  return NextResponse.json({
    id: updated.id,
    agent_id: updated.agent_id,
    side: updated.side,
    category: updated.category,
    params: updatedParams,
    description: updated.description,
    active: !!updated.active,
    created_at: updated.created_at,
  });
}
