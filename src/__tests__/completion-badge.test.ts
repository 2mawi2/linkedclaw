import { describe, expect, it } from "bun:test";
import { computeCompletionRate } from "@/lib/badges";

describe("computeCompletionRate", () => {
  it("returns not eligible when fewer than 3 resolved deals", () => {
    const result = computeCompletionRate(1, 1);
    expect(result.eligible).toBe(false);
    expect(result.tier).toBe("none");
    expect(result.rate).toBe(100);
  });

  it("returns not eligible with 0 deals", () => {
    const result = computeCompletionRate(0, 0);
    expect(result.eligible).toBe(false);
    expect(result.rate).toBe(0);
  });

  it("returns not eligible with 2 resolved deals", () => {
    const result = computeCompletionRate(2, 2);
    expect(result.eligible).toBe(false);
    expect(result.rate).toBe(100);
  });

  it("returns platinum for 100% with 3+ deals", () => {
    const result = computeCompletionRate(5, 5);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(100);
    expect(result.tier).toBe("platinum");
    expect(result.label).toBe("Platinum reliability");
  });

  it("returns platinum for 95%+", () => {
    const result = computeCompletionRate(19, 20);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(95);
    expect(result.tier).toBe("platinum");
  });

  it("returns gold for 80-94%", () => {
    const result = computeCompletionRate(8, 10);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(80);
    expect(result.tier).toBe("gold");
    expect(result.label).toBe("Highly reliable");
  });

  it("returns silver for 60-79%", () => {
    const result = computeCompletionRate(7, 10);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(70);
    expect(result.tier).toBe("silver");
    expect(result.label).toBe("Reliable");
  });

  it("returns bronze for 40-59%", () => {
    const result = computeCompletionRate(5, 10);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(50);
    expect(result.tier).toBe("bronze");
    expect(result.label).toBe("Moderate");
  });

  it("returns bronze with needs improvement for <40%", () => {
    const result = computeCompletionRate(1, 5);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(20);
    expect(result.tier).toBe("bronze");
    expect(result.label).toBe("Needs improvement");
  });

  it("handles exact boundary at 95%", () => {
    // 95% exactly should be platinum
    const result = computeCompletionRate(95, 100);
    expect(result.tier).toBe("platinum");
  });

  it("handles exact boundary at 80%", () => {
    const result = computeCompletionRate(80, 100);
    expect(result.tier).toBe("gold");
  });

  it("handles exact boundary at 60%", () => {
    const result = computeCompletionRate(60, 100);
    expect(result.tier).toBe("silver");
  });

  it("handles exact boundary at 40%", () => {
    const result = computeCompletionRate(40, 100);
    expect(result.tier).toBe("bronze");
    expect(result.label).toBe("Moderate");
  });

  it("rounds rate correctly", () => {
    // 7/9 = 77.78% -> should round to 78
    const result = computeCompletionRate(7, 9);
    expect(result.rate).toBe(78);
    expect(result.tier).toBe("silver");
  });

  it("handles minimum eligible threshold (3 deals)", () => {
    const result = computeCompletionRate(3, 3);
    expect(result.eligible).toBe(true);
    expect(result.rate).toBe(100);
    expect(result.tier).toBe("platinum");
  });
});
