/**
 * Listing deduplication - detect near-duplicate listings from the same agent.
 *
 * Uses text similarity (Jaccard on word tokens) + category/side/skills overlap
 * to compute a dedup score. Scores above a threshold flag potential duplicates.
 */

export interface DedupCandidate {
  profile_id: string;
  side: string;
  category: string;
  description: string | null;
  params: Record<string, unknown>;
  created_at: string;
}

export interface DedupResult {
  duplicate_of: string;
  score: number; // 0-100
  reasons: string[];
}

/** Tokenize text into lowercase word set */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

/** Jaccard similarity between two sets (0-1) */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Extract skills array from params */
function getSkills(params: Record<string, unknown>): string[] {
  const skills = params.skills;
  if (Array.isArray(skills)) return skills.map((s) => String(s).toLowerCase());
  if (typeof skills === "string") return skills.split(",").map((s) => s.trim().toLowerCase());
  return [];
}

/**
 * Compare a new listing candidate against an existing one.
 * Returns a score (0-100) and reasons for potential duplication.
 */
export function computeDedupScore(
  newListing: DedupCandidate,
  existing: DedupCandidate,
): DedupResult {
  const reasons: string[] = [];
  let score = 0;

  // Same side (required for true duplication)
  if (newListing.side !== existing.side) {
    return { duplicate_of: existing.profile_id, score: 0, reasons: [] };
  }

  // Category match: +30
  if (newListing.category.toLowerCase() === existing.category.toLowerCase()) {
    score += 30;
    reasons.push("same_category");
  }

  // Description similarity: up to +40
  if (newListing.description && existing.description) {
    const newTokens = tokenize(newListing.description);
    const existTokens = tokenize(existing.description);
    const descSim = jaccard(newTokens, existTokens);
    const descPoints = Math.round(descSim * 40);
    if (descPoints > 0) {
      score += descPoints;
      if (descSim >= 0.5) reasons.push("similar_description");
    }
  } else if (!newListing.description && !existing.description) {
    // Both have no description - slight bump if same category
    if (newListing.category.toLowerCase() === existing.category.toLowerCase()) {
      score += 10;
    }
  }

  // Skills overlap: up to +30
  const newSkills = new Set(getSkills(newListing.params));
  const existSkills = new Set(getSkills(existing.params));
  if (newSkills.size > 0 && existSkills.size > 0) {
    const skillSim = jaccard(newSkills, existSkills);
    const skillPoints = Math.round(skillSim * 30);
    if (skillPoints > 0) {
      score += skillPoints;
      if (skillSim >= 0.5) reasons.push("overlapping_skills");
    }
  } else if (newSkills.size === 0 && existSkills.size === 0) {
    // Both have no skills listed
    score += 5;
  }

  return { duplicate_of: existing.profile_id, score: Math.min(score, 100), reasons };
}

/** Default threshold above which a listing is considered a near-duplicate */
export const DEDUP_THRESHOLD = 60;
