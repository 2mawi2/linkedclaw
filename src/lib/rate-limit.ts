import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs * 2;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

/**
 * Check rate limit for a request. Returns null if allowed, or a 429 Response if exceeded.
 *
 * @param req - The incoming request (used for IP extraction)
 * @param limit - Max requests allowed in the window
 * @param windowMs - Window size in milliseconds (default: 60000 = 1 minute)
 * @param keyPrefix - Optional prefix to separate different endpoint limits
 */
export function checkRateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number = 60_000,
  keyPrefix: string = "",
): NextResponse | null {
  // Skip rate limiting in test environment
  if (process.env.VITEST || process.env.NODE_ENV === "test") return null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const key = `${keyPrefix}:${ip}`;
  const now = Date.now();

  cleanup(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > now - windowMs);

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);

    return NextResponse.json(
      {
        error: "Too many requests",
        retry_after: retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((oldestInWindow + windowMs) / 1000)),
        },
      },
    );
  }

  entry.timestamps.push(now);
  return null;
}

/** Get rate limit usage stats for a given IP across all prefixes */
export function getRateLimitStats(ip: string): Array<{
  prefix: string;
  used: number;
  limit: number;
  windowMs: number;
  remaining: number;
  resetsAt: number | null;
}> {
  const now = Date.now();
  const results: Array<{
    prefix: string;
    used: number;
    limit: number;
    windowMs: number;
    remaining: number;
    resetsAt: number | null;
  }> = [];

  for (const [name, config] of Object.entries(RATE_LIMITS)) {
    const key = `${config.prefix}:${ip}`;
    const entry = store.get(key);
    const windowMs = config.windowMs;
    const cutoff = now - windowMs;
    const timestamps = entry
      ? entry.timestamps.filter((t) => t > cutoff)
      : [];
    const used = timestamps.length;
    const remaining = Math.max(0, config.limit - used);
    const resetsAt =
      timestamps.length > 0
        ? Math.ceil((timestamps[0] + windowMs) / 1000)
        : null;

    results.push({
      prefix: name.toLowerCase(),
      used,
      limit: config.limit,
      windowMs,
      remaining,
      resetsAt,
    });
  }

  return results;
}

/** Reset rate limit store (for testing) */
export function _resetRateLimitStore(): void {
  store.clear();
}

// Preset limits
export const RATE_LIMITS = {
  /** Key generation: 5 per minute */
  KEY_GEN: { limit: 5, windowMs: 60_000, prefix: "keygen" },
  /** Write operations: 30 per minute */
  WRITE: { limit: 30, windowMs: 60_000, prefix: "write" },
  /** Read operations: 60 per minute */
  READ: { limit: 60, windowMs: 60_000, prefix: "read" },
} as const;
