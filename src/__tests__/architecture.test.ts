import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/** Recursively get all .ts/.tsx files in a directory */
function getFiles(dir: string, ext = /\.(ts|tsx)$/): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      files.push(...getFiles(full, ext));
    } else if (ext.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const SRC = join(process.cwd(), "src");
const API_ROUTES = join(SRC, "app", "api");
const LIB = join(SRC, "lib");

describe("Architecture", () => {
  describe("API routes use authenticateAny (not authenticateRequest)", () => {
    const routeFiles = getFiles(API_ROUTES).filter((f) => f.endsWith("route.ts"));

    for (const file of routeFiles) {
      const content = readFileSync(file, "utf-8");
      const relativePath = file.replace(process.cwd() + "/", "");

      // Skip public-only routes that don't need auth
      const publicRoutes = ["/api/register", "/api/login", "/api/stats", "/api/categories", "/api/search", "/api/tags", "/api/openapi.json", "/api/market", "/skill/"];
      const isPublic = publicRoutes.some((r) => relativePath.includes(r.replace(/\//g, "/")));
      if (isPublic) continue;

      // Only check routes that import auth at all
      if (!content.includes("authenticate")) continue;

      it(`${relativePath} uses authenticateAny`, () => {
        // Should not use the old authenticateRequest directly
        expect(content).not.toMatch(/\bauthenticateRequest\b/);
        expect(content).toMatch(/\bauthenticateAny\b/);
      });
    }
  });

  describe("No direct console.log in production code", () => {
    const srcFiles = getFiles(SRC).filter((f) => !f.includes("__tests__"));

    for (const file of srcFiles) {
      const content = readFileSync(file, "utf-8");
      const relativePath = file.replace(process.cwd() + "/", "");

      it(`${relativePath} has no console.log`, () => {
        // Allow console.error and console.warn, but not console.log in prod
        const lines = content.split("\n");
        const logLines = lines
          .map((l, i) => ({ line: i + 1, text: l }))
          .filter((l) => /\bconsole\.log\b/.test(l.text) && !l.text.trim().startsWith("//"));
        expect(logLines, `Found console.log at lines: ${logLines.map((l) => l.line).join(", ")}`).toHaveLength(0);
      });
    }
  });

  describe("All API route files export HTTP method handlers", () => {
    const routeFiles = getFiles(API_ROUTES).filter((f) => f.endsWith("route.ts"));

    for (const file of routeFiles) {
      const content = readFileSync(file, "utf-8");
      const relativePath = file.replace(process.cwd() + "/", "");

      it(`${relativePath} exports at least one HTTP handler`, () => {
        const hasHandler = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(content);
        expect(hasHandler, "Must export GET, POST, PUT, PATCH, or DELETE").toBe(true);
      });
    }
  });

  describe("Database access goes through ensureDb", () => {
    const routeFiles = getFiles(API_ROUTES).filter((f) => f.endsWith("route.ts"));

    for (const file of routeFiles) {
      const content = readFileSync(file, "utf-8");
      const relativePath = file.replace(process.cwd() + "/", "");

      // Only check routes that use the database
      if (!content.includes("ensureDb") && !content.includes("getDb")) continue;

      it(`${relativePath} uses ensureDb (not getDb directly)`, () => {
        expect(content).toMatch(/\bensureDb\b/);
        expect(content).not.toMatch(/\bgetDb\b/);
      });
    }
  });

  describe("Page files exist for all frontend routes", () => {
    const expectedPages = ["", "login", "register", "browse", "connect", "deals"];

    for (const route of expectedPages) {
      it(`/${route} has a page.tsx`, () => {
        const pagePath = join(SRC, "app", route, "page.tsx");
        expect(() => readFileSync(pagePath)).not.toThrow();
      });
    }
  });

  describe("No secrets or IPs in source", () => {
    const allFiles = getFiles(SRC).filter((f) => !f.includes("__tests__"));

    for (const file of allFiles) {
      const content = readFileSync(file, "utf-8");
      const relativePath = file.replace(process.cwd() + "/", "");

      it(`${relativePath} has no hardcoded secrets`, () => {
        // Check for hardcoded API keys
        expect(content).not.toMatch(/lc_[a-f0-9]{32}/);
        // Check for hardcoded IPs (common server IP patterns)
        expect(content).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b(?!\.0|\.1\b|255)/);
      });
    }
  });
});
