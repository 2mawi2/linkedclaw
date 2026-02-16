import { describe, it, expect } from "vitest";
import { suggestFromDescription } from "@/lib/category-suggestions";

describe("Category Suggestions", () => {
  describe("suggestFromDescription", () => {
    it("suggests freelance-dev for a TypeScript/React description", () => {
      const result = suggestFromDescription(
        "Full-stack TypeScript developer specializing in React and Node.js applications",
      );
      expect(result.categories.length).toBeGreaterThan(0);
      expect(result.categories[0].category).toBe("freelance-dev");
      expect(result.categories[0].confidence).toBeGreaterThan(0);
      expect(result.categories[0].label).toBe("Freelance Development");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("TypeScript");
      expect(skillNames).toContain("React");
      expect(skillNames).toContain("Node.js");
    });

    it("suggests devops for infrastructure description", () => {
      const result = suggestFromDescription(
        "DevOps engineer experienced with Docker, Kubernetes, and AWS cloud deployments. CI/CD pipeline setup.",
      );
      expect(result.categories[0].category).toBe("devops");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("Docker");
      expect(skillNames).toContain("Kubernetes");
      expect(skillNames).toContain("AWS");
    });

    it("suggests ai-ml for machine learning description", () => {
      const result = suggestFromDescription(
        "Machine learning specialist with NLP and deep learning experience. Fine-tuning LLMs and building RAG systems.",
      );
      expect(result.categories[0].category).toBe("ai-ml");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("Machine Learning");
      expect(skillNames).toContain("NLP");
    });

    it("suggests content-writing for documentation description", () => {
      const result = suggestFromDescription(
        "Technical writer creating API documentation, tutorials, and blog posts. Experienced with OpenAPI specs.",
      );
      expect(result.categories[0].category).toBe("content-writing");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("Technical Writing");
      expect(skillNames).toContain("API Documentation");
    });

    it("suggests design for UI/UX description", () => {
      const result = suggestFromDescription(
        "UI/UX designer creating wireframes and mockups in Figma. Responsive design for web and mobile.",
      );
      expect(result.categories[0].category).toBe("design");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("Figma");
    });

    it("suggests data-processing for data description", () => {
      const result = suggestFromDescription(
        "Data analyst working with SQL databases and pandas for ETL pipelines and visualization dashboards.",
      );
      expect(result.categories[0].category).toBe("data-processing");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("SQL");
      expect(skillNames).toContain("Pandas");
    });

    it("suggests mobile-dev for mobile app description", () => {
      const result = suggestFromDescription(
        "Mobile app developer building iOS and Android apps with React Native and Flutter.",
      );
      expect(result.categories[0].category).toBe("mobile-dev");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("React Native");
      expect(skillNames).toContain("Flutter");
    });

    it("suggests blockchain for Web3 description", () => {
      const result = suggestFromDescription(
        "Smart contract developer working with Solidity on Ethereum. Building DeFi protocols and dApps.",
      );
      expect(result.categories[0].category).toBe("blockchain");

      const skillNames = result.skills.map((s) => s.skill);
      expect(skillNames).toContain("Solidity");
    });

    it("respects maxCategories limit", () => {
      const result = suggestFromDescription(
        "Full-stack developer doing DevOps, data analysis, and writing documentation",
        1,
      );
      expect(result.categories.length).toBeLessThanOrEqual(1);
    });

    it("respects maxSkills limit", () => {
      const result = suggestFromDescription(
        "TypeScript React Node.js Python Docker Kubernetes AWS PostgreSQL Redis GraphQL",
        3,
        2,
      );
      expect(result.skills.length).toBeLessThanOrEqual(2);
    });

    it("returns empty arrays for empty description", () => {
      const result = suggestFromDescription("");
      expect(result.categories).toEqual([]);
      expect(result.skills).toEqual([]);
    });

    it("returns empty arrays for irrelevant text", () => {
      const result = suggestFromDescription("I enjoy hiking and cooking pasta");
      expect(result.categories).toEqual([]);
      expect(result.skills).toEqual([]);
    });

    it("categories are sorted by confidence descending", () => {
      const result = suggestFromDescription(
        "Software developer who also writes documentation and blog posts about coding",
      );
      for (let i = 1; i < result.categories.length; i++) {
        expect(result.categories[i].confidence).toBeLessThanOrEqual(
          result.categories[i - 1].confidence,
        );
      }
    });

    it("confidence values are between 0 and 1", () => {
      const result = suggestFromDescription(
        "Full-stack TypeScript developer doing DevOps with Docker and AWS",
      );
      for (const cat of result.categories) {
        expect(cat.confidence).toBeGreaterThan(0);
        expect(cat.confidence).toBeLessThanOrEqual(1);
      }
      for (const sk of result.skills) {
        expect(sk.confidence).toBeGreaterThan(0);
        expect(sk.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("skill suggestions include matched_term", () => {
      const result = suggestFromDescription("Building apps with React and TypeScript");
      for (const sk of result.skills) {
        expect(sk.matched_term).toBeTruthy();
        expect(typeof sk.matched_term).toBe("string");
      }
    });
  });
});
