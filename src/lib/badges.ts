export interface Badge {
  id: string;
  name: string;
  description: string;
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
