/**
 * Listing quality score engine.
 *
 * Scores a listing on completeness and provides actionable suggestions
 * for improving it. Used by GET /api/listings/:id/quality and batch scoring.
 *
 * Scoring dimensions (total 100):
 * - Description quality (0-30): length, detail, readability
 * - Skills completeness (0-20): number and specificity of skills
 * - Rate range (0-15): has rate, reasonable spread
 * - Availability info (0-10): availability, hours, duration specified
 * - Category (0-10): has a valid category set
 * - Metadata (0-15): remote preference, location, currency
 */

import type { ProfileParams } from "./types";

export interface QualityDimension {
  name: string;
  score: number;
  max: number;
  suggestions: string[];
}

export interface QualityResult {
  overall_score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: QualityDimension[];
  suggestions: string[]; // top suggestions across all dimensions
}

/** Minimum description length considered "good" */
const GOOD_DESC_LENGTH = 100;
/** Minimum description length considered "acceptable" */
const OK_DESC_LENGTH = 30;
/** Ideal number of skills */
const IDEAL_SKILL_COUNT = 3;
/** Max reasonable rate spread multiplier (max/min) */
const MAX_RATE_SPREAD = 5;

function scoreDescription(description: string | null | undefined): QualityDimension {
  const dim: QualityDimension = { name: "description", score: 0, max: 30, suggestions: [] };

  if (!description || description.trim().length === 0) {
    dim.suggestions.push("Add a description to help others understand what you offer or need");
    return dim;
  }

  const text = description.trim();
  const len = text.length;

  // Length scoring (0-15)
  if (len >= GOOD_DESC_LENGTH) {
    dim.score += 15;
  } else if (len >= OK_DESC_LENGTH) {
    dim.score += Math.round((len / GOOD_DESC_LENGTH) * 15);
  } else {
    dim.score += Math.round((len / OK_DESC_LENGTH) * 5);
    dim.suggestions.push(
      `Description is short (${len} chars). Aim for at least ${GOOD_DESC_LENGTH} characters`,
    );
  }

  // Word variety (0-8) - more unique words = more detailed
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const uniqueWords = new Set(words).size;
  if (uniqueWords >= 30) {
    dim.score += 8;
  } else if (uniqueWords >= 15) {
    dim.score += Math.round((uniqueWords / 30) * 8);
  } else {
    dim.score += Math.round((uniqueWords / 15) * 3);
    if (uniqueWords < 10) {
      dim.suggestions.push(
        "Add more detail to your description - explain your experience, tools, or deliverables",
      );
    }
  }

  // Has sentences / structure (0-7)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  if (sentences.length >= 3) {
    dim.score += 7;
  } else if (sentences.length >= 2) {
    dim.score += 4;
  } else {
    dim.score += 2;
    dim.suggestions.push("Break your description into multiple sentences for readability");
  }

  return dim;
}

function scoreSkills(params: ProfileParams): QualityDimension {
  const dim: QualityDimension = { name: "skills", score: 0, max: 20, suggestions: [] };

  const skills = params.skills;
  if (!skills || !Array.isArray(skills) || skills.length === 0) {
    dim.suggestions.push("Add relevant skills to improve match quality");
    return dim;
  }

  // Count scoring (0-12)
  if (skills.length >= IDEAL_SKILL_COUNT) {
    dim.score += 12;
  } else {
    dim.score += Math.round((skills.length / IDEAL_SKILL_COUNT) * 12);
    dim.suggestions.push(
      `Add more skills (currently ${skills.length}, recommend at least ${IDEAL_SKILL_COUNT})`,
    );
  }

  // Specificity scoring (0-8) - longer skill names tend to be more specific
  const avgLen = skills.reduce((sum, s) => sum + s.length, 0) / skills.length;
  if (avgLen >= 6) {
    dim.score += 8;
  } else if (avgLen >= 3) {
    dim.score += 4;
    dim.suggestions.push("Use specific skill names (e.g. 'React Native' instead of 'mobile')");
  } else {
    dim.score += 2;
    dim.suggestions.push("Skill names are too vague - be specific about technologies and tools");
  }

  return dim;
}

function scoreRateRange(params: ProfileParams): QualityDimension {
  const dim: QualityDimension = { name: "rate_range", score: 0, max: 15, suggestions: [] };

  const hasMin = typeof params.rate_min === "number" && params.rate_min > 0;
  const hasMax = typeof params.rate_max === "number" && params.rate_max > 0;

  if (!hasMin && !hasMax) {
    dim.suggestions.push("Add a rate range to attract compatible matches");
    return dim;
  }

  // Has at least one rate (0-8)
  if (hasMin && hasMax) {
    dim.score += 8;
  } else {
    dim.score += 4;
    dim.suggestions.push("Specify both minimum and maximum rate for better matching");
  }

  // Rate spread reasonableness (0-4)
  if (hasMin && hasMax) {
    const spread = params.rate_max! / params.rate_min!;
    if (spread <= 2) {
      dim.score += 4;
    } else if (spread <= MAX_RATE_SPREAD) {
      dim.score += 2;
      dim.suggestions.push(
        "Rate range is wide - narrowing it signals confidence and attracts serious matches",
      );
    } else {
      dim.score += 0;
      dim.suggestions.push("Rate range is very wide - consider narrowing for better match quality");
    }
  }

  // Currency specified (0-3)
  if (params.currency && params.currency.length > 0) {
    dim.score += 3;
  } else {
    dim.suggestions.push("Specify a currency (e.g. USD, EUR) for your rate");
  }

  return dim;
}

function scoreAvailability(params: ProfileParams): QualityDimension {
  const dim: QualityDimension = { name: "availability", score: 0, max: 10, suggestions: [] };

  // Availability text (0-4)
  if (params.availability && params.availability.trim().length > 0) {
    dim.score += 4;
  } else {
    dim.suggestions.push("Add availability info (e.g. 'immediate', 'from March 2026')");
  }

  // Hours range (0-3)
  if (typeof params.hours_min === "number" || typeof params.hours_max === "number") {
    dim.score += 3;
  } else {
    dim.suggestions.push("Specify hours per week to set expectations");
  }

  // Duration (0-3)
  if (
    typeof params.duration_min_weeks === "number" ||
    typeof params.duration_max_weeks === "number"
  ) {
    dim.score += 3;
  } else {
    dim.suggestions.push("Add expected duration to help agents plan");
  }

  return dim;
}

function scoreCategory(category: string | null | undefined): QualityDimension {
  const dim: QualityDimension = { name: "category", score: 0, max: 10, suggestions: [] };

  if (!category || category.trim().length === 0) {
    dim.suggestions.push("Set a category so matching agents can find your listing");
    return dim;
  }

  dim.score += 10;
  return dim;
}

function scoreMetadata(params: ProfileParams): QualityDimension {
  const dim: QualityDimension = { name: "metadata", score: 0, max: 15, suggestions: [] };

  // Remote preference (0-6)
  if (params.remote) {
    dim.score += 6;
  } else {
    dim.suggestions.push("Specify remote/onsite/hybrid preference");
  }

  // Location (0-5)
  if (params.location && params.location.trim().length > 0) {
    dim.score += 5;
  } else {
    dim.suggestions.push("Add a location for better geographic matching");
  }

  // Extra params count (0-4) - more filled fields = more complete
  const extras = ["currency", "hours_min", "hours_max", "duration_min_weeks", "duration_max_weeks"];
  const filledExtras = extras.filter(
    (k) => params[k] !== undefined && params[k] !== null && params[k] !== "",
  ).length;
  if (filledExtras >= 3) {
    dim.score += 4;
  } else if (filledExtras >= 1) {
    dim.score += 2;
  }

  return dim;
}

function gradeFromScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

/**
 * Compute a quality score for a listing profile.
 *
 * @param description - The listing description text
 * @param category - The listing category
 * @param params - The parsed profile params (skills, rates, etc.)
 * @returns QualityResult with overall score, grade, dimensions, and suggestions
 */
export function computeQualityScore(
  description: string | null | undefined,
  category: string | null | undefined,
  params: ProfileParams,
): QualityResult {
  const dimensions = [
    scoreDescription(description),
    scoreSkills(params),
    scoreRateRange(params),
    scoreAvailability(params),
    scoreCategory(category),
    scoreMetadata(params),
  ];

  const overall_score = dimensions.reduce((sum, d) => sum + d.score, 0);
  const grade = gradeFromScore(overall_score);

  // Collect top suggestions - prioritize dimensions with lowest score-to-max ratio
  const sorted = [...dimensions].sort((a, b) => a.score / a.max - b.score / b.max);
  const suggestions: string[] = [];
  for (const dim of sorted) {
    for (const s of dim.suggestions) {
      if (suggestions.length < 5) suggestions.push(s);
    }
  }

  return { overall_score, grade, dimensions, suggestions };
}
