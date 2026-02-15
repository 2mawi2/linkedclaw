import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { authenticateAny } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
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

/** Create a deal directly between two agents (bypasses matching engine) */
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

  const b = body as Record<string, unknown>;
  if (!b.agent_id || typeof b.agent_id !== "string") {
    return NextResponse.json({ error: "agent_id is required" }, { status: 400 });
  }
  if (b.agent_id !== auth.agent_id) {
    return NextResponse.json(
      { error: "agent_id does not match authenticated key" },
      { status: 403 },
    );
  }
  if (!b.counterpart_profile_id && !b.counterpart_agent_id) {
    return NextResponse.json(
      { error: "counterpart_profile_id or counterpart_agent_id is required" },
      { status: 400 },
    );
  }

  const db = await ensureDb();

  // Find initiator's active profile
  const myProfilesResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
    args: [b.agent_id as string],
  });
  const myProfile = myProfilesResult.rows[0] as unknown as Profile | undefined;
  if (!myProfile) {
    return NextResponse.json(
      { error: "You have no active profile. Post a listing first via POST /api/connect" },
      { status: 400 },
    );
  }

  // Find counterpart profile
  let counterpart: Profile | undefined;
  if (b.counterpart_profile_id) {
    const r = await db.execute({
      sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
      args: [b.counterpart_profile_id as string],
    });
    counterpart = r.rows[0] as unknown as Profile | undefined;
  } else {
    const r = await db.execute({
      sql: "SELECT * FROM profiles WHERE agent_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
      args: [b.counterpart_agent_id as string],
    });
    counterpart = r.rows[0] as unknown as Profile | undefined;
  }

  if (!counterpart) {
    return NextResponse.json({ error: "Counterpart profile not found" }, { status: 404 });
  }
  if (counterpart.agent_id === (b.agent_id as string)) {
    return NextResponse.json({ error: "Cannot create a deal with yourself" }, { status: 400 });
  }

  // Check for existing match
  const [aId, bId] =
    myProfile.id < counterpart.id ? [myProfile.id, counterpart.id] : [counterpart.id, myProfile.id];
  const existingResult = await db.execute({
    sql: "SELECT id FROM matches WHERE profile_a_id = ? AND profile_b_id = ?",
    args: [aId, bId],
  });
  const existing = existingResult.rows[0] as unknown as { id: string } | undefined;
  if (existing) {
    return NextResponse.json({
      match_id: existing.id,
      message: "Deal already exists",
      existing: true,
    });
  }

  // Compute basic overlap
  const myParams: ProfileParams = JSON.parse(myProfile.params);
  const theirParams: ProfileParams = JSON.parse(counterpart.params);
  const mySkills = (myParams.skills ?? []).map((s) => s.toLowerCase());
  const theirSkills = (theirParams.skills ?? []).map((s) => s.toLowerCase());
  const matchingSkills = mySkills.filter((s) => theirSkills.includes(s));

  let rateOverlap: { min: number; max: number } | null = null;
  if (
    myParams.rate_min != null && myParams.rate_max != null &&
    theirParams.rate_min != null && theirParams.rate_max != null
  ) {
    const oMin = Math.max(myParams.rate_min, theirParams.rate_min);
    const oMax = Math.min(myParams.rate_max, theirParams.rate_max);
    if (oMin <= oMax) rateOverlap = { min: oMin, max: oMax };
  }

  const overlap = {
    matching_skills: matchingSkills,
    rate_overlap: rateOverlap,
    remote_compatible: true,
    score: matchingSkills.length > 0 ? 50 + matchingSkills.length * 10 : 30,
  };

  const matchId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  await db.execute({
    sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, expires_at) VALUES (?, ?, ?, ?, ?)",
    args: [matchId, aId, bId, JSON.stringify(overlap), expiresAt],
  });

  await createNotification(db, {
    agent_id: counterpart.agent_id,
    type: "new_match",
    match_id: matchId,
    from_agent_id: b.agent_id as string,
    summary: `${b.agent_id} wants to start a deal with you`,
  });

  return NextResponse.json({
    match_id: matchId,
    overlap,
    counterpart_agent_id: counterpart.agent_id,
    message: "Deal created. Send a message to start negotiating.",
  }, { status: 201 });
}
