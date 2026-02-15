import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, _resetRateLimitStore } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

function makeReq(ip: string = "127.0.0.1"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rate-limit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("allows requests under the limit", () => {
    const req = makeReq();
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(req, 5, 60_000, "test");
      expect(result).toBeNull();
    }
  });

  it("blocks requests over the limit", () => {
    const req = makeReq();
    // Fill up the limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(req, 5, 60_000, "test");
    }
    // Next one should be blocked
    const result = checkRateLimit(req, 5, 60_000, "test");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("returns correct retry-after header", async () => {
    const req = makeReq();
    for (let i = 0; i < 3; i++) {
      checkRateLimit(req, 3, 60_000, "test");
    }
    const result = checkRateLimit(req, 3, 60_000, "test");
    expect(result).not.toBeNull();
    const body = await result!.json();
    expect(body.error).toBe("Too many requests");
    expect(body.retry_after).toBeGreaterThan(0);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
    expect(result!.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("tracks different IPs independently", () => {
    const req1 = makeReq("1.2.3.4");
    const req2 = makeReq("5.6.7.8");

    // Fill up limit for IP 1
    for (let i = 0; i < 3; i++) {
      checkRateLimit(req1, 3, 60_000, "test");
    }

    // IP 1 should be blocked
    expect(checkRateLimit(req1, 3, 60_000, "test")).not.toBeNull();

    // IP 2 should still be allowed
    expect(checkRateLimit(req2, 3, 60_000, "test")).toBeNull();
  });

  it("tracks different prefixes independently", () => {
    const req = makeReq();

    // Fill up "write" limit
    for (let i = 0; i < 3; i++) {
      checkRateLimit(req, 3, 60_000, "write");
    }

    // "write" should be blocked
    expect(checkRateLimit(req, 3, 60_000, "write")).not.toBeNull();

    // "read" should still be allowed
    expect(checkRateLimit(req, 3, 60_000, "read")).toBeNull();
  });

  it("uses x-real-ip as fallback", () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { "x-real-ip": "10.0.0.1" },
    });

    for (let i = 0; i < 2; i++) {
      checkRateLimit(req, 2, 60_000, "test");
    }

    expect(checkRateLimit(req, 2, 60_000, "test")).not.toBeNull();
  });
});
