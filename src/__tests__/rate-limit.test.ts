import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  checkRateLimit,
  withRateLimit,
  withKeyGenRateLimit,
  withWriteRateLimit,
  withReadRateLimit,
  _resetRateLimitStore,
} from "@/lib/rate-limit";

beforeEach(() => {
  _resetRateLimitStore();
});

function makeReq(ip: string = "1.2.3.4"): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("test-key", 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - i - 1);
    }
  });

  it("blocks requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-key", 5, 60_000);
    }
    const result = checkRateLimit("test-key", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows requests again after the window expires", () => {
    // Use a tiny window so timestamps expire immediately
    const windowMs = 1; // 1 ms

    for (let i = 0; i < 5; i++) {
      checkRateLimit("expire-key", 5, windowMs);
    }

    // Wait a couple ms so the window slides past all timestamps
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy-wait
    }

    const result = checkRateLimit("expire-key", 5, windowMs);
    expect(result.allowed).toBe(true);
  });

  it("uses separate buckets for different keys", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("key-a", 3, 60_000);
    }
    // key-a is now exhausted
    expect(checkRateLimit("key-a", 3, 60_000).allowed).toBe(false);

    // key-b should still be fine
    expect(checkRateLimit("key-b", 3, 60_000).allowed).toBe(true);
  });
});

describe("withRateLimit", () => {
  it("returns null when under the limit", () => {
    const req = makeReq();
    const result = withRateLimit(req, 10, 60_000, "test");
    expect(result).toBeNull();
  });

  it("returns 429 response when over the limit", async () => {
    const req = makeReq();
    for (let i = 0; i < 3; i++) {
      withRateLimit(req, 3, 60_000, "block-test");
    }

    const resp = withRateLimit(req, 3, 60_000, "block-test");
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(429);

    const body = await resp!.json();
    expect(body.error).toContain("Too many requests");

    const retryAfter = resp!.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(parseInt(retryAfter!)).toBeGreaterThan(0);
  });

  it("separates IPs", () => {
    const reqA = makeReq("10.0.0.1");
    const reqB = makeReq("10.0.0.2");

    for (let i = 0; i < 2; i++) {
      withRateLimit(reqA, 2, 60_000, "ip-test");
    }
    // A is blocked
    expect(withRateLimit(reqA, 2, 60_000, "ip-test")).not.toBeNull();
    // B is fine
    expect(withRateLimit(reqB, 2, 60_000, "ip-test")).toBeNull();
  });
});

describe("preset helpers", () => {
  it("withKeyGenRateLimit allows 5 then blocks", () => {
    const req = makeReq("5.5.5.5");
    for (let i = 0; i < 5; i++) {
      expect(withKeyGenRateLimit(req)).toBeNull();
    }
    expect(withKeyGenRateLimit(req)).not.toBeNull();
    expect(withKeyGenRateLimit(req)!.status).toBe(429);
  });

  it("withWriteRateLimit allows 30 then blocks", () => {
    const req = makeReq("6.6.6.6");
    for (let i = 0; i < 30; i++) {
      expect(withWriteRateLimit(req)).toBeNull();
    }
    expect(withWriteRateLimit(req)).not.toBeNull();
  });

  it("withReadRateLimit allows 60 then blocks", () => {
    const req = makeReq("7.7.7.7");
    for (let i = 0; i < 60; i++) {
      expect(withReadRateLimit(req)).toBeNull();
    }
    expect(withReadRateLimit(req)).not.toBeNull();
  });
});
