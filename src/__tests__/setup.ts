import { beforeEach } from "vitest";
import { _resetRateLimitStore } from "@/lib/rate-limit";

// Reset rate limit store between every test to prevent cross-test interference
beforeEach(() => {
  _resetRateLimitStore();
});
