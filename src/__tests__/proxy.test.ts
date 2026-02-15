import { describe, test, expect } from "vitest";

// Mirror the proxy logic for testing
const PUBLIC_ANY_METHOD = ["/", "/login", "/register", "/api/register", "/api/login"];
const PUBLIC_GET_ONLY = [
  "/api/stats",
  "/api/categories",
  "/api/search",
  "/api/tags",
  "/api/templates",
  "/api/projects",
  "/api/openapi.json",
];
const PUBLIC_GET_PREFIXES = [
  "/api/agents/",
  "/api/reputation/",
  "/api/market/",
  "/api/connect/",
  "/api/profiles/",
  "/browse",
];

function isPublicPath(pathname: string, method: string): boolean {
  if (PUBLIC_ANY_METHOD.includes(pathname)) return true;
  if (method === "GET") {
    if (PUBLIC_GET_ONLY.includes(pathname)) return true;
    if (PUBLIC_GET_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  }
  return false;
}

describe("proxy public paths", () => {
  test("allows GET on exact public paths", () => {
    expect(isPublicPath("/api/stats", "GET")).toBe(true);
    expect(isPublicPath("/api/search", "GET")).toBe(true);
    expect(isPublicPath("/api/categories", "GET")).toBe(true);
    expect(isPublicPath("/api/tags", "GET")).toBe(true);
    expect(isPublicPath("/api/templates", "GET")).toBe(true);
    expect(isPublicPath("/api/projects", "GET")).toBe(true);
    expect(isPublicPath("/api/openapi.json", "GET")).toBe(true);
    expect(isPublicPath("/", "GET")).toBe(true);
    expect(isPublicPath("/login", "GET")).toBe(true);
    expect(isPublicPath("/register", "GET")).toBe(true);
    expect(isPublicPath("/browse", "GET")).toBe(true);
    expect(isPublicPath("/browse/listing-123", "GET")).toBe(true);
  });

  test("allows POST on auth endpoints", () => {
    expect(isPublicPath("/api/register", "POST")).toBe(true);
    expect(isPublicPath("/api/login", "POST")).toBe(true);
  });

  test("blocks unauthenticated POST on /api/keys", () => {
    expect(isPublicPath("/api/keys", "POST")).toBe(false);
  });

  test("allows GET on prefix-matched public paths", () => {
    expect(isPublicPath("/api/agents/test-agent/summary", "GET")).toBe(true);
    expect(isPublicPath("/api/agents/test-agent/portfolio", "GET")).toBe(true);
    expect(isPublicPath("/api/reputation/test-agent", "GET")).toBe(true);
    expect(isPublicPath("/api/market/ai-development", "GET")).toBe(true);
    expect(isPublicPath("/api/connect/test-agent", "GET")).toBe(true);
    expect(isPublicPath("/api/profiles/prof-123", "GET")).toBe(true);
  });

  test("blocks POST on non-auth public paths", () => {
    expect(isPublicPath("/api/stats", "POST")).toBe(false);
    expect(isPublicPath("/api/search", "POST")).toBe(false);
  });

  test("blocks non-public paths", () => {
    expect(isPublicPath("/api/deals", "GET")).toBe(false);
    expect(isPublicPath("/api/inbox", "GET")).toBe(false);
    expect(isPublicPath("/api/activity", "GET")).toBe(false);
    expect(isPublicPath("/api/webhooks", "GET")).toBe(false);
  });

  test("blocks POST on prefix-matched paths (needs auth)", () => {
    expect(isPublicPath("/api/reputation/test-agent/review", "POST")).toBe(false);
    expect(isPublicPath("/api/connect/test-agent", "POST")).toBe(false);
  });
});
