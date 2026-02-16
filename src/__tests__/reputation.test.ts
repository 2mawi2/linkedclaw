import { describe, it, expect } from "vitest";
import { computeReputationScore } from "@/lib/reputation";

describe("computeReputationScore", () => {
  it("returns unrated for zero activity", () => {
    const result = computeReputationScore({
      avg_rating: 0,
      total_reviews: 0,
      completed_deals: 0,
      total_resolved_deals: 0,
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe("unrated");
    expect(result.components.review_quality).toBe(0);
    expect(result.components.deal_volume).toBe(0);
    expect(result.components.success_rate).toBe(0);
  });

  it("returns established for agent with one deal, no reviews", () => {
    const result = computeReputationScore({
      avg_rating: 0,
      total_reviews: 0,
      completed_deals: 1,
      total_resolved_deals: 1,
    });
    expect(result.level).toBe("established");
    expect(result.score).toBeGreaterThan(40);
    // neutral review (50) * 0.4 + small volume * 0.3 + 100% success * 0.3
    expect(result.components.review_quality).toBe(50); // neutral when no reviews
    expect(result.components.success_rate).toBe(100);
  });

  it("returns high score for perfect agent", () => {
    const result = computeReputationScore({
      avg_rating: 5.0,
      total_reviews: 10,
      completed_deals: 20,
      total_resolved_deals: 20,
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe("elite");
    expect(result.components.review_quality).toBe(100);
    expect(result.components.success_rate).toBe(100);
    expect(result.components.deal_volume).toBe(100);
  });

  it("penalizes low success rate", () => {
    const good = computeReputationScore({
      avg_rating: 4.0,
      total_reviews: 5,
      completed_deals: 10,
      total_resolved_deals: 10,
    });
    const bad = computeReputationScore({
      avg_rating: 4.0,
      total_reviews: 5,
      completed_deals: 3,
      total_resolved_deals: 10,
    });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(bad.components.success_rate).toBe(30);
    expect(good.components.success_rate).toBe(100);
  });

  it("penalizes low review ratings", () => {
    const good = computeReputationScore({
      avg_rating: 5.0,
      total_reviews: 5,
      completed_deals: 5,
      total_resolved_deals: 5,
    });
    const bad = computeReputationScore({
      avg_rating: 2.0,
      total_reviews: 5,
      completed_deals: 5,
      total_resolved_deals: 5,
    });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(bad.components.review_quality).toBe(40);
    expect(good.components.review_quality).toBe(100);
  });

  it("volume scales logarithmically", () => {
    const few = computeReputationScore({
      avg_rating: 4.0,
      total_reviews: 3,
      completed_deals: 2,
      total_resolved_deals: 2,
    });
    const many = computeReputationScore({
      avg_rating: 4.0,
      total_reviews: 3,
      completed_deals: 20,
      total_resolved_deals: 20,
    });
    expect(many.components.deal_volume).toBeGreaterThan(few.components.deal_volume);
    expect(many.components.deal_volume).toBe(100); // caps at ~20
  });

  it("assigns correct levels", () => {
    // Elite: score >= 85, completed > 0
    const elite = computeReputationScore({
      avg_rating: 5.0,
      total_reviews: 10,
      completed_deals: 20,
      total_resolved_deals: 20,
    });
    expect(elite.level).toBe("elite");

    // Trusted: score >= 70
    const trusted = computeReputationScore({
      avg_rating: 4.0,
      total_reviews: 3,
      completed_deals: 8,
      total_resolved_deals: 10,
    });
    expect(trusted.level).toBe("trusted");

    // Established: score >= 40, completed > 0
    const established = computeReputationScore({
      avg_rating: 3.0,
      total_reviews: 2,
      completed_deals: 3,
      total_resolved_deals: 6,
    });
    expect(established.level).toBe("established");
  });

  it("score never exceeds 100", () => {
    const result = computeReputationScore({
      avg_rating: 5.0,
      total_reviews: 100,
      completed_deals: 100,
      total_resolved_deals: 100,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("uses neutral defaults when no reviews but has deals", () => {
    const result = computeReputationScore({
      avg_rating: 0,
      total_reviews: 0,
      completed_deals: 5,
      total_resolved_deals: 5,
    });
    // 50 * 0.4 + volume * 0.3 + 100 * 0.3
    expect(result.components.review_quality).toBe(50);
    expect(result.components.success_rate).toBe(100);
    expect(result.score).toBeGreaterThan(50);
  });
});
