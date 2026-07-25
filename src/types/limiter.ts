import type { Request } from "express";
import type { AllowlistConfig } from "../middleware/allowlist.js";

export type KeyGenerator = (req: Request) => string;

export type RateLimiterStore = "memory" | "redis";

interface BaseRateLimiterConfig {
  keyGenerator?: KeyGenerator;
  // Trusted callers matching this allowlist skip the algorithm entirely.
  // Omit to disable bypass for the route.
  allowlist?: AllowlistConfig;
}

export interface FixedWindowRateLimiterConfig extends BaseRateLimiterConfig {
  algorithm: "fixedWindow";
  store: RateLimiterStore;
  limit: number;
  windowSeconds: number;
}

export interface TokenBucketRateLimiterConfig extends BaseRateLimiterConfig {
  algorithm: "tokenBucket";
  store: RateLimiterStore;
  maxTokens: number;
  refillRatePerSec: number;
}

export type RateLimiterConfig =
  | FixedWindowRateLimiterConfig
  | TokenBucketRateLimiterConfig;
