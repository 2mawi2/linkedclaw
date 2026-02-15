import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import type { Profile, ProfileParams } from "@/lib/types";

interface DealRow {
  id: string;
  status: string;
  overlap_summary: string;
  created_at: string;
  counterpart_agent_id: string;
  counterpart_description: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agent_id");

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: "agent_id query parameter is required" }, { status: 400 });
  }

  const db = await ensureDb();

  // Find all profile ids for this agent
  const profilesResult = await db.execute({
    sql: "SELECT id FROM profiles WHERE agent_id = ?",
    args: [agentId],
  });
  const profiles = profilesResult.rows as unknown as Array<{ id: string }>;

  if (profiles.length === 0) {
    return NextResponse.json({ deals: [] });
  }

  const profileIds = profiles.map((p) => p.id);
  const placeholders = profileIds.map(() => "?").join(",");

  const dealsResult = await db.execute({
    sql: `SELECT m.id, m.status, m.overlap_summary, m.created_at,
       CASE
         WHEN m.profile_a_id IN (${placeholders}) THEN pb.agent_id
         ELSE pa.agent_id
       END as counterpart_agent_id,
       CASE
         WHEN m.profile_a_id IN (${placeholders}) THEN pb.description
         ELSE pa.description
       END as counterpart_description
     FROM matches m
     JOIN profiles pa ON pa.id = m.profile_a_id
     JOIN profiles pb ON pb.id = m.profile_b_id
     WHERE m.profile_a_id IN (${placeholders}) OR m.profile_b_id IN (${placeholders})`,
    args: [...profileIds, ...profileIds, ...profileIds, ...profileIds],
  });
  const deals = dealsResult.rows as unknown as DealRow[];

  return NextResponse.json({
    deals: deals.map((d) => ({
      match_id: d.id,
      status: d.status,
      overlap: JSON.parse(d.overlap_summary),
      counterpart_agent_id: d.counterpart_agent_id,
      counterpart_description: d.counterpart_description,
      created_at: d.created_at,
    })),
  });
}

/**
 * POST /api/deals - Initiate a deal between two profiles directly.
 * Allows bots to start negotiations with profiles found via search,
 * bypassing the automatic matching engine.
 *
 * Body: { profile_id: string, target_profile_id: string, message?: string }
 * Auth: Bearer token required (must own profile_id)
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAny(req);
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { profile_id?: string; target_profile_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { profile_id, target_profile_id, message } = body;

  if (!profile_id || !target_profile_id) {
    return NextResponse.json(
      { error: "profile_id and target_profile_id are required" },
      { status: 400 },
    );
  }

  if (profile_id === target_profile_id) {
    return NextResponse.json({ error: "Cannot initiate a deal with yourself" }, { status: 400 });
  }

  const db = await ensureDb();

  // Verify the caller owns profile_id
  const myProfileResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND agent_id = ? AND active = 1",
    args: [profile_id, auth.agent_id],
  });
  const myProfile = myProfileResult.rows[0] as unknown as Profile | undefined;
  if (!myProfile) {
    return NextResponse.json(
      { error: "profile_id not found or not owned by you" },
      { status: 403 },
    );
  }

  // Verify target profile exists and is active
  const targetResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
    args: [target_profile_id],
  });
  const targetProfile = targetResult.rows[0] as unknown as Profile | undefined;
  if (!targetProfile) {
    return NextResponse.json({ error: "Target profile not found or inactive" }, { status: 404 });
  }

  // Don't allow same agent to deal with themselves
  if (targetProfile.agent_id === auth.agent_id) {
    return NextResponse.json(
      { error: "Cannot initiate a deal with your own profile" },
      { status: 400 },
    );
  }

  // Check for existing deal between these profiles
  const [aId, bId] =
    profile_id < target_profile_id
      ? [profile_id, target_profile_id]
      : [target_profile_id, profile_id];

  const existingResult = await db.execute({
    sql: "SELECT id, status FROM matches WHERE profile_a_id = ? AND profile_b_id = ?",
    args: [aId, bId],
  });
  const existing = existingResult.rows[0] as unknown as { id: string; status: string } | undefined;

  if (existing) {
    return NextResponse.json(
      {
        match_id: existing.id,
        status: existing.status,
        message: "A deal already exists between these profiles",
        existing: true,
      },
      { status: 200 },
    );
  }

  // Build a basic overlap summary
  const myParams: ProfileParams = JSON.parse(myProfile.params);
  const targetParams: ProfileParams = JSON.parse(targetProfile.params);
  const mySkills = (myParams.skills ?? []).map((s) => s.toLowerCase());
  const targetSkills = (targetParams.skills ?? []).map((s) => s.toLowerCase());
  const sharedSkills = mySkills.filter((s) => targetSkills.includes(s));

  const overlap = {
    score: sharedSkills.length > 0 ? Math.min(sharedSkills.length * 25, 100) : 10,
    shared_skills: sharedSkills,
    rate_overlap:
      myParams.rate_min != null &&
      targetParams.rate_max != null &&
      myParams.rate_min <= (targetParams.rate_max ?? Infinity),
    initiated_by: auth.agent_id,
  };

  // Create the match (deal)
  const matchId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  await db.execute({
    sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, status, expires_at) VALUES (?, ?, ?, ?, 'negotiating', ?)",
    args: [matchId, aId, bId, JSON.stringify(overlap), expiresAt],
  });

  // Send optional opening message
  if (message) {
    await db.execute({
      sql: "INSERT INTO messages (match_id, sender_agent_id, content, message_type) VALUES (?, ?, ?, 'negotiation')",
      args: [matchId, auth.agent_id, message],
    });
  }

  // Notify the target agent
  await createNotification(db, {
    agent_id: targetProfile.agent_id,
    type: "new_match",
    match_id: matchId,
    from_agent_id: auth.agent_id,
    summary: `${auth.agent_id} wants to start a deal with you${message ? ": " + message.slice(0, 100) : ""}`,
  });

  return NextResponse.json(
    {
      match_id: matchId,
      status: "negotiating",
      overlap,
      target_agent_id: targetProfile.agent_id,
      message: "Deal initiated successfully",
    },
    { status: 201 },
  );
}
