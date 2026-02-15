import { ensureDb } from "./db";
import type { Profile, ProfileParams, OverlapSummary } from "./types";
import { createNotification } from "./notifications";

export async function findMatches(
  profileId: string,
): Promise<Array<{ matchId: string; counterpart: Profile; overlap: OverlapSummary }>> {
  const db = await ensureDb();
  const profileResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE id = ? AND active = 1",
    args: [profileId],
  });
  const profile = profileResult.rows[0] as unknown as Profile | undefined;
  if (!profile) return [];

  const oppositeSide = profile.side === "offering" ? "seeking" : "offering";
  // Match across all categories - skills and rates are the real signals
  const candidatesResult = await db.execute({
    sql: "SELECT * FROM profiles WHERE side = ? AND active = 1 AND agent_id != ?",
    args: [oppositeSide, profile.agent_id],
  });
  const candidates = candidatesResult.rows as unknown as Profile[];

  const results: Array<{ matchId: string; counterpart: Profile; overlap: OverlapSummary }> = [];

  for (const candidate of candidates) {
    const overlap = computeOverlap(profile, candidate);
    if (!overlap) continue;

    // Consistent ordering: lower id first
    const [aId, bId] =
      profile.id < candidate.id ? [profile.id, candidate.id] : [candidate.id, profile.id];
    const existingResult = await db.execute({
      sql: "SELECT id FROM matches WHERE profile_a_id = ? AND profile_b_id = ?",
      args: [aId, bId],
    });
    const existing = existingResult.rows[0] as unknown as { id: string } | undefined;

    if (existing) {
      results.push({ matchId: existing.id, counterpart: candidate, overlap });
    } else {
      const matchId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      await db.execute({
        sql: "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, expires_at) VALUES (?, ?, ?, ?, ?)",
        args: [matchId, aId, bId, JSON.stringify(overlap), expiresAt],
      });
      // Notify both sides about the new match
      await createNotification(db, {
        agent_id: candidate.agent_id,
        type: "new_match",
        match_id: matchId,
        from_agent_id: profile.agent_id,
        summary: `New match found with ${profile.agent_id} (${overlap.score}% compatibility)`,
      });
      await createNotification(db, {
        agent_id: profile.agent_id,
        type: "new_match",
        match_id: matchId,
        from_agent_id: candidate.agent_id,
        summary: `New match found with ${candidate.agent_id} (${overlap.score}% compatibility)`,
      });
      results.push({ matchId, counterpart: candidate, overlap });
    }
  }

  return results.sort((a, b) => b.overlap.score - a.overlap.score);
}

function computeOverlap(a: Profile, b: Profile): OverlapSummary | null {
  const aParams: ProfileParams = JSON.parse(a.params);
  const bParams: ProfileParams = JSON.parse(b.params);

  // Skills overlap
  const aSkills = (aParams.skills ?? []).map((s) => s.toLowerCase());
  const bSkills = (bParams.skills ?? []).map((s) => s.toLowerCase());
  const matchingSkills = aSkills.filter((s) => bSkills.includes(s));
  if (aSkills.length > 0 && bSkills.length > 0 && matchingSkills.length === 0) return null;

  // Rate/budget overlap
  let rateOverlap: { min: number; max: number } | null = null;
  if (
    aParams.rate_min != null &&
    aParams.rate_max != null &&
    bParams.rate_min != null &&
    bParams.rate_max != null
  ) {
    const overlapMin = Math.max(aParams.rate_min, bParams.rate_min);
    const overlapMax = Math.min(aParams.rate_max, bParams.rate_max);
    if (overlapMin > overlapMax) return null;
    rateOverlap = { min: overlapMin, max: overlapMax };
  }

  // Remote compatibility
  let remoteCompatible = true;
  if (aParams.remote && bParams.remote) {
    if (
      aParams.remote !== bParams.remote &&
      aParams.remote !== "hybrid" &&
      bParams.remote !== "hybrid"
    ) {
      remoteCompatible = false;
      return null;
    }
  }

  const categoryBonus = a.category === b.category ? 0.15 : 0;

  const minSkillSet = Math.min(aSkills.length, bSkills.length);
  let skillScore = 0.5;
  if (minSkillSet > 0) {
    skillScore = matchingSkills.length / minSkillSet;
  } else if (aSkills.length === 0 && bSkills.length === 0) {
    skillScore = 0.5;
  }

  let rateScore = 0.5;
  if (rateOverlap && aParams.rate_max != null && bParams.rate_min != null) {
    const totalRange =
      Math.max(aParams.rate_max, bParams.rate_max ?? 0) -
      Math.min(aParams.rate_min ?? 0, bParams.rate_min);
    rateScore = totalRange > 0 ? (rateOverlap.max - rateOverlap.min) / totalRange : 0.5;
  }

  const remoteBonus = remoteCompatible ? 0.05 : 0;
  const descBonus = a.description && b.description ? 0.05 : 0;

  const score = Math.min(
    100,
    Math.round(
      (categoryBonus + skillScore * 0.45 + rateScore * 0.25 + remoteBonus + descBonus) * 100,
    ),
  );

  return {
    matching_skills: matchingSkills,
    rate_overlap: rateOverlap,
    remote_compatible: remoteCompatible,
    score,
  };
}
