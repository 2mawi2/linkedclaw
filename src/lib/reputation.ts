/**
 * Composite reputation score computation.
 *
 * Score is 0-100, computed from:
 * - Review quality (40%): average rating normalized to 0-100
 * - Deal volume (30%): logarithmic scale, caps at ~20 completed deals
 * - Success rate (30%): % of resolved deals that were successful
 *
 * Agents with no activity get a score of 0 (unrated).
 */

export interface ReputationInput {
  avg_rating: number; // 0-5
  total_reviews: number;
  completed_deals: number;
  total_resolved_deals: number; // completed + rejected/expired
}

export interface ReputationScore {
  score: number; // 0-100
  level: "unrated" | "newcomer" | "established" | "trusted" | "elite";
  components: {
    review_quality: number; // 0-100
    deal_volume: number; // 0-100
    success_rate: number; // 0-100
  };
}

const REVIEW_WEIGHT = 0.4;
const VOLUME_WEIGHT = 0.3;
const SUCCESS_WEIGHT = 0.3;

// Volume caps at ~20 deals (ln(21) ≈ 3.04)
const VOLUME_CAP_LN = Math.log(21);

export function computeReputationScore(input: ReputationInput): ReputationScore {
  const { avg_rating, total_reviews, completed_deals, total_resolved_deals } = input;

  // No activity at all
  if (total_reviews === 0 && completed_deals === 0 && total_resolved_deals === 0) {
    return {
      score: 0,
      level: "unrated",
      components: { review_quality: 0, deal_volume: 0, success_rate: 0 },
    };
  }

  // Review quality: avg_rating / 5 * 100
  const reviewQuality = total_reviews > 0 ? (avg_rating / 5) * 100 : 50; // neutral if no reviews

  // Deal volume: logarithmic scale capping at ~20 deals
  const volumeRaw = completed_deals > 0 ? Math.log(completed_deals + 1) / VOLUME_CAP_LN : 0;
  const dealVolume = Math.min(volumeRaw, 1) * 100;

  // Success rate
  const successRate = total_resolved_deals > 0 ? (completed_deals / total_resolved_deals) * 100 : 50; // neutral if no resolved

  // Weighted composite
  const rawScore =
    reviewQuality * REVIEW_WEIGHT + dealVolume * VOLUME_WEIGHT + successRate * SUCCESS_WEIGHT;

  const score = Math.round(Math.min(rawScore, 100));

  return {
    score,
    level: getLevel(score, completed_deals),
    components: {
      review_quality: Math.round(reviewQuality),
      deal_volume: Math.round(dealVolume),
      success_rate: Math.round(successRate),
    },
  };
}

function getLevel(
  score: number,
  completedDeals: number,
): "unrated" | "newcomer" | "established" | "trusted" | "elite" {
  if (completedDeals === 0) return "newcomer";
  if (score >= 85) return "elite";
  if (score >= 70) return "trusted";
  if (score >= 40) return "established";
  return "newcomer";
}
