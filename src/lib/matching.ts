import { getDb } from "./db";
import type { Profile, ProfileParams, OverlapSummary } from "./types";

export function findMatches(profileId: string): Array<{ matchId: string; counterpart: Profile; overlap: OverlapSummary }> {
  const db = getDb();
  const profile = db.prepare("SELECT * FROM profiles WHERE id = ? AND active = 1").get(profileId) as Profile | undefined;
  if (!profile) return [];

  const oppositeSide = profile.side === "offering" ? "seeking" : "offering";
  const candidates = db.prepare(
    "SELECT * FROM profiles WHERE side = ? AND category = ? AND active = 1 AND id != ?"
  ).all(oppositeSide, profile.category, profileId) as Profile[];

  const results: Array<{ matchId: string; counterpart: Profile; overlap: OverlapSummary }> = [];

  for (const candidate of candidates) {
    const overlap = computeOverlap(profile, candidate);
    if (!overlap) continue;

    // Consistent ordering: lower id first
    const [aId, bId] = profile.id < candidate.id ? [profile.id, candidate.id] : [candidate.id, profile.id];
    const existing = db.prepare(
      "SELECT id FROM matches WHERE profile_a_id = ? AND profile_b_id = ?"
    ).get(aId, bId) as { id: string } | undefined;

    if (existing) {
      results.push({ matchId: existing.id, counterpart: candidate, overlap });
    } else {
      const matchId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary) VALUES (?, ?, ?, ?)"
      ).run(matchId, aId, bId, JSON.stringify(overlap));
      results.push({ matchId, counterpart: candidate, overlap });
    }
  }

  return results.sort((a, b) => b.overlap.score - a.overlap.score);
}

function computeOverlap(a: Profile, b: Profile): OverlapSummary | null {
  const aParams: ProfileParams = JSON.parse(a.params);
  const bParams: ProfileParams = JSON.parse(b.params);

  // Skills overlap
  const aSkills = (aParams.skills ?? []).map(s => s.toLowerCase());
  const bSkills = (bParams.skills ?? []).map(s => s.toLowerCase());
  const matchingSkills = aSkills.filter(s => bSkills.includes(s));
  if (aSkills.length > 0 && bSkills.length > 0 && matchingSkills.length === 0) return null;

  // Rate/budget overlap
  let rateOverlap: { min: number; max: number } | null = null;
  if (aParams.rate_min != null && aParams.rate_max != null && bParams.rate_min != null && bParams.rate_max != null) {
    const overlapMin = Math.max(aParams.rate_min, bParams.rate_min);
    const overlapMax = Math.min(aParams.rate_max, bParams.rate_max);
    if (overlapMin > overlapMax) return null;
    rateOverlap = { min: overlapMin, max: overlapMax };
  }

  // Remote compatibility
  let remoteCompatible = true;
  if (aParams.remote && bParams.remote) {
    if (aParams.remote !== bParams.remote && aParams.remote !== "hybrid" && bParams.remote !== "hybrid") {
      remoteCompatible = false;
      return null;
    }
  }

  // Score: skill match ratio + rate overlap bonus
  const allSkills = new Set([...aSkills, ...bSkills]);
  const skillScore = allSkills.size > 0 ? matchingSkills.length / allSkills.size : 0.5;
  let rateScore = 0.5;
  if (rateOverlap && aParams.rate_max != null && bParams.rate_min != null) {
    const totalRange = Math.max(aParams.rate_max, bParams.rate_max ?? 0) - Math.min(aParams.rate_min ?? 0, bParams.rate_min);
    rateScore = totalRange > 0 ? (rateOverlap.max - rateOverlap.min) / totalRange : 0.5;
  }
  const score = Math.round((skillScore * 0.6 + rateScore * 0.4) * 100);

  return { matching_skills: matchingSkills, rate_overlap: rateOverlap, remote_compatible: remoteCompatible, score };
}
