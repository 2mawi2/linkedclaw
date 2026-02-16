export interface Badge {
  id: string;
  name: string;
  description: string;
}

export interface CompletionRateBadge {
  rate: number; // 0-100
  tier: "none" | "bronze" | "silver" | "gold" | "platinum";
  label: string;
  eligible: boolean; // need at least 3 resolved deals to show
}

/**
 * Compute deal completion rate badge.
 * Requires at least 3 resolved deals to be eligible (avoids misleading 100% on 1 deal).
 */
export function computeCompletionRate(
  completedDeals: number,
  totalResolvedDeals: number,
): CompletionRateBadge {
  if (totalResolvedDeals < 3) {
    const rate =
      totalResolvedDeals > 0 ? Math.round((completedDeals / totalResolvedDeals) * 100) : 0;
    return { rate, tier: "none", label: "Too few deals", eligible: false };
  }

  const rate = Math.round((completedDeals / totalResolvedDeals) * 100);

  let tier: CompletionRateBadge["tier"];
  let label: string;

  if (rate >= 95) {
    tier = "platinum";
    label = "Platinum reliability";
  } else if (rate >= 80) {
    tier = "gold";
    label = "Highly reliable";
  } else if (rate >= 60) {
    tier = "silver";
    label = "Reliable";
  } else if (rate >= 40) {
    tier = "bronze";
    label = "Moderate";
  } else {
    tier = "bronze";
    label = "Needs improvement";
  }

  return { rate, tier, label, eligible: true };
}

export function categoryLevel(completedDeals: number): "gold" | "silver" | "bronze" {
  if (completedDeals >= 10) return "gold";
  if (completedDeals >= 3) return "silver";
  return "bronze";
}

export function computeBadges(opts: {
  totalCompleted: number;
  verifiedCategoryCount: number;
  reviewCount: number;
  avgRating: number;
}): Badge[] {
  const badges: Badge[] = [];
  const { totalCompleted, verifiedCategoryCount, reviewCount, avgRating } = opts;

  if (totalCompleted >= 1)
    badges.push({
      id: "first_deal",
      name: "First Deal",
      description: "Completed first deal on LinkedClaw",
    });
  if (totalCompleted >= 5)
    badges.push({ id: "prolific", name: "Prolific", description: "Completed 5+ deals" });
  if (totalCompleted >= 10)
    badges.push({ id: "veteran", name: "Veteran", description: "Completed 10+ deals" });
  if (verifiedCategoryCount >= 3)
    badges.push({
      id: "multi_category",
      name: "Multi-Category",
      description: "Completed deals in 3+ categories",
    });
  if (reviewCount >= 3 && avgRating >= 4.0)
    badges.push({
      id: "highly_rated",
      name: "Highly Rated",
      description: "Average rating of 4.0+ with 3+ reviews",
    });
  if (reviewCount >= 3 && avgRating >= 4.8)
    badges.push({
      id: "exceptional",
      name: "Exceptional",
      description: "Average rating of 4.8+ with 3+ reviews",
    });

  return badges;
}
