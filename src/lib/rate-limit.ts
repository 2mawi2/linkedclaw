import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory sliding window rate limiter.
 *
 * Each key (typically an IP address) maps to an array of request timestamps.
 * On each check we drop timestamps outside the current window, then decide
 * whether to allow or reject the request.
 */

interface RateLimitEntry {
  timestamps: number[];
}

// Global store – lives for the lifetime of the process.
const store = new Map<string, RateLimitEntry>();

// Periodic cleanup interval (every 60 s) to avoid unbounded memory growth.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - 120_000) {
        store.delete(key);
      }
    }
  }, 60_000);
  // Allow the process to exit even if the timer is still running.
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Extract a rate-limit key from the request (IP-based).
 */
function getKey(req: NextRequest, prefix: string): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "127.0.0.1";
  return `${prefix}:${ip}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Core rate-limit check.
 *
 * @param key   – unique key (e.g. "keys:1.2.3.4")
 * @param limit – max requests allowed in the window
 * @param windowMs – sliding window size in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  ensureCleanup();

  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the window
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    // Earliest timestamp still in the window – that's when a slot opens.
    const oldest = entry.timestamps[0];
    const retryAfterMs = oldest + windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: limit - entry.timestamps.length, retryAfterMs: 0 };
}

/**
 * Helper to call at the top of a Next.js route handler.
 *
 * Returns `null` when the request is allowed, or a 429 `NextResponse` when rate-limited.
 *
 * @param req      – incoming request
 * @param limit    – max requests in the window
 * @param windowMs – sliding window in milliseconds (default 60 000 = 1 minute)
 * @param prefix   – key namespace (default "global")
 */
export function withRateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number = 60_000,
  prefix: string = "global",
): NextResponse | null {
  const key = getKey(req, prefix);
  const result = checkRateLimit(key, limit, windowMs);

  if (!result.allowed) {
    const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  return null; // allowed
}

// ── Preset helpers ────────────────────────────────────────────────

/** Strict limit for key generation: 5 req / min */
export function withKeyGenRateLimit(req: NextRequest): NextResponse | null {
  return withRateLimit(req, 5, 60_000, "keygen");
}

/** Write endpoints (POST/PATCH/DELETE): 30 req / min */
export function withWriteRateLimit(req: NextRequest): NextResponse | null {
  return withRateLimit(req, 30, 60_000, "write");
}

/** Read endpoints (GET): 60 req / min */
export function withReadRateLimit(req: NextRequest): NextResponse | null {
  return withRateLimit(req, 60, 60_000, "read");
}

/**
 * Reset the in-memory store. Useful for tests.
 */
export function _resetRateLimitStore(): void {
  store.clear();
}
