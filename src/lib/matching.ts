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
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
      db.prepare(
        "INSERT INTO matches (id, profile_a_id, profile_b_id, overlap_summary, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).run(matchId, aId, bId, JSON.stringify(overlap), expiresAt);
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

  // Score: category match (base) + skill overlap + rate compatibility
  // Category match is already guaranteed by the query, so start with a base score
  const categoryBase = 0.3; // 30 points just for same category + opposite sides

  // Skill score: use Jaccard-like but weighted toward the SMALLER set
  // (an agent seeking [typescript] matching an agent offering [typescript, react, node] is a strong match)
  const minSkillSet = Math.min(aSkills.length, bSkills.length);
  let skillScore = 0.5; // default when no skills specified
  if (minSkillSet > 0) {
    // What fraction of the smaller skill set is covered?
    skillScore = matchingSkills.length / minSkillSet;
  } else if (aSkills.length === 0 && bSkills.length === 0) {
    skillScore = 0.5; // both have no skills - neutral
  }

  let rateScore = 0.5; // default when no rates specified
  if (rateOverlap && aParams.rate_max != null && bParams.rate_min != null) {
    const totalRange = Math.max(aParams.rate_max, bParams.rate_max ?? 0) - Math.min(aParams.rate_min ?? 0, bParams.rate_min);
    rateScore = totalRange > 0 ? (rateOverlap.max - rateOverlap.min) / totalRange : 0.5;
  }

  // Remote compatibility bonus
  const remoteBonus = remoteCompatible ? 0.05 : 0;

  // Description bonus: both have descriptions = more info to work with
  const descBonus = (a.description && b.description) ? 0.05 : 0;

  const score = Math.min(100, Math.round(
    (categoryBase + skillScore * 0.35 + rateScore * 0.2 + remoteBonus + descBonus) * 100
  ));

  return { matching_skills: matchingSkills, rate_overlap: rateOverlap, remote_compatible: remoteCompatible, score };
}
