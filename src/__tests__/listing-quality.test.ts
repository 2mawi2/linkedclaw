import { describe, it, expect } from "vitest";
import { computeQualityScore } from "@/lib/listing-quality";
import type { ProfileParams } from "@/lib/types";

describe("Listing Quality Score", () => {
  describe("computeQualityScore", () => {
    it("returns a perfect-ish score for a complete listing", () => {
      const params: ProfileParams = {
        skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        rate_min: 100,
        rate_max: 150,
        currency: "EUR",
        availability: "immediate",
        hours_min: 20,
        hours_max: 40,
        duration_min_weeks: 4,
        duration_max_weeks: 12,
        remote: "remote",
        location: "Berlin, Germany",
      };
      const description =
        "Senior full-stack developer with 8 years of experience building scalable web applications. " +
        "Specialized in TypeScript, React, and Node.js with PostgreSQL databases. " +
        "I deliver clean, tested code with CI/CD pipelines and documentation.";
      const result = computeQualityScore(description, "freelance-dev", params);

      expect(result.overall_score).toBeGreaterThanOrEqual(80);
      expect(result.grade).toBe("A");
      expect(result.dimensions).toHaveLength(6);
      expect(result.suggestions.length).toBeLessThanOrEqual(5);
    });

    it("returns a low score for an empty listing", () => {
      const result = computeQualityScore(null, null, {});

      expect(result.overall_score).toBeLessThan(20);
      expect(result.grade).toBe("F");
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("returns grade F for score < 20", () => {
      const result = computeQualityScore(null, null, {});
      expect(result.grade).toBe("F");
    });

    it("returns grade D for score 20-39", () => {
      // Minimal listing - just a category and short description
      const result = computeQualityScore("I do web development work.", "freelance-dev", {
        skills: ["JS"],
      });
      expect(result.overall_score).toBeGreaterThanOrEqual(20);
      expect(result.overall_score).toBeLessThan(40);
      expect(result.grade).toBe("D");
    });

    it("scores description length properly", () => {
      const shortResult = computeQualityScore("Hi", null, {});
      const longResult = computeQualityScore(
        "I am a senior developer with extensive experience in building enterprise applications. " +
          "My expertise spans frontend and backend development with modern JavaScript frameworks. " +
          "I focus on writing maintainable, well-tested code.",
        null,
        {},
      );

      const shortDesc = shortResult.dimensions.find((d) => d.name === "description")!;
      const longDesc = longResult.dimensions.find((d) => d.name === "description")!;
      expect(longDesc.score).toBeGreaterThan(shortDesc.score);
    });

    it("suggests adding description when missing", () => {
      const result = computeQualityScore(null, "freelance-dev", {});
      const descDim = result.dimensions.find((d) => d.name === "description")!;
      expect(descDim.score).toBe(0);
      expect(descDim.suggestions).toContain(
        "Add a description to help others understand what you offer or need",
      );
    });

    it("suggests adding skills when missing", () => {
      const result = computeQualityScore("Some description here.", "freelance-dev", {});
      const skillsDim = result.dimensions.find((d) => d.name === "skills")!;
      expect(skillsDim.score).toBe(0);
      expect(skillsDim.suggestions).toContain("Add relevant skills to improve match quality");
    });

    it("scores skills count properly", () => {
      const fewSkills = computeQualityScore(null, null, { skills: ["JS"] });
      const moreSkills = computeQualityScore(null, null, {
        skills: ["TypeScript", "React", "Node.js"],
      });

      const fewDim = fewSkills.dimensions.find((d) => d.name === "skills")!;
      const moreDim = moreSkills.dimensions.find((d) => d.name === "skills")!;
      expect(moreDim.score).toBeGreaterThan(fewDim.score);
    });

    it("suggests adding rate range when missing", () => {
      const result = computeQualityScore(null, null, {});
      const rateDim = result.dimensions.find((d) => d.name === "rate_range")!;
      expect(rateDim.score).toBe(0);
      expect(rateDim.suggestions).toContain("Add a rate range to attract compatible matches");
    });

    it("scores rate range with both min and max higher", () => {
      const oneRate = computeQualityScore(null, null, { rate_min: 50 });
      const bothRates = computeQualityScore(null, null, {
        rate_min: 50,
        rate_max: 80,
        currency: "USD",
      });

      const oneDim = oneRate.dimensions.find((d) => d.name === "rate_range")!;
      const bothDim = bothRates.dimensions.find((d) => d.name === "rate_range")!;
      expect(bothDim.score).toBeGreaterThan(oneDim.score);
    });

    it("penalizes very wide rate spread", () => {
      const narrow = computeQualityScore(null, null, {
        rate_min: 100,
        rate_max: 150,
        currency: "USD",
      });
      const wide = computeQualityScore(null, null, {
        rate_min: 10,
        rate_max: 500,
        currency: "USD",
      });

      const narrowDim = narrow.dimensions.find((d) => d.name === "rate_range")!;
      const wideDim = wide.dimensions.find((d) => d.name === "rate_range")!;
      expect(narrowDim.score).toBeGreaterThan(wideDim.score);
    });

    it("scores availability info", () => {
      const noAvail = computeQualityScore(null, null, {});
      const withAvail = computeQualityScore(null, null, {
        availability: "immediate",
        hours_min: 20,
        hours_max: 40,
        duration_min_weeks: 4,
      });

      const noDim = noAvail.dimensions.find((d) => d.name === "availability")!;
      const withDim = withAvail.dimensions.find((d) => d.name === "availability")!;
      expect(withDim.score).toBe(withDim.max);
      expect(noDim.score).toBe(0);
    });

    it("scores category presence", () => {
      const noCat = computeQualityScore(null, null, {});
      const withCat = computeQualityScore(null, "freelance-dev", {});

      const noDim = noCat.dimensions.find((d) => d.name === "category")!;
      const withDim = withCat.dimensions.find((d) => d.name === "category")!;
      expect(withDim.score).toBe(10);
      expect(noDim.score).toBe(0);
    });

    it("scores metadata completeness", () => {
      const noMeta = computeQualityScore(null, null, {});
      const withMeta = computeQualityScore(null, null, {
        remote: "remote",
        location: "Berlin",
        currency: "EUR",
        hours_min: 20,
        hours_max: 40,
      });

      const noDim = noMeta.dimensions.find((d) => d.name === "metadata")!;
      const withDim = withMeta.dimensions.find((d) => d.name === "metadata")!;
      expect(withDim.score).toBeGreaterThan(noDim.score);
    });

    it("limits suggestions to 5", () => {
      // Empty listing generates many suggestions but should cap at 5
      const result = computeQualityScore(null, null, {});
      expect(result.suggestions.length).toBeLessThanOrEqual(5);
    });

    it("prioritizes suggestions from weakest dimensions", () => {
      // A listing with only a good category but nothing else
      const result = computeQualityScore(null, "freelance-dev", {});
      // Category is perfect, so its suggestions should NOT be in top suggestions
      const catDim = result.dimensions.find((d) => d.name === "category")!;
      expect(catDim.suggestions).toHaveLength(0);
      // Other dimensions should have suggestions
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("all dimension scores are within their max", () => {
      const params: ProfileParams = {
        skills: ["TypeScript", "React", "Node.js"],
        rate_min: 100,
        rate_max: 150,
        currency: "EUR",
        availability: "immediate",
        hours_min: 20,
        hours_max: 40,
        duration_min_weeks: 4,
        remote: "remote",
        location: "Berlin",
      };
      const result = computeQualityScore(
        "Detailed description that is quite long and covers many topics in depth with multiple sentences. " +
          "I have years of experience working on complex systems. My specialty is performance optimization.",
        "freelance-dev",
        params,
      );

      for (const dim of result.dimensions) {
        expect(dim.score).toBeLessThanOrEqual(dim.max);
        expect(dim.score).toBeGreaterThanOrEqual(0);
      }
    });

    it("overall score equals sum of dimension scores", () => {
      const result = computeQualityScore("Some description.", "freelance-dev", {
        skills: ["TypeScript"],
        rate_min: 80,
        rate_max: 120,
      });
      const sum = result.dimensions.reduce((s, d) => s + d.score, 0);
      expect(result.overall_score).toBe(sum);
    });
  });
});
