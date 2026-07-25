import type { NextFunction, Request, Response } from "express";
import type { RateLimiterConfig } from "../types/limiter.js";
import { fixedWindowCounter } from "./fixedWindowCounter.js";
import { tokenBucketLimiter } from "./tokenBucketLimiter.js";
import { redisFixedWindowRateLimiter } from "./redisFixedWindowRateLimiter.js";
import { redisTokenBucketLimiter } from "./redisTokenBucketRateLimiter.js";
import { isTrustedCaller } from "./allowlist.js";

type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

function buildAlgorithm(config: RateLimiterConfig): Middleware {
  if (config.algorithm === "fixedWindow") {
    return config.store === "redis"
      ? redisFixedWindowRateLimiter(
          config.windowSeconds,
          config.limit,
          config.keyGenerator,
        )
      : fixedWindowCounter(
          config.windowSeconds * 1000,
          config.limit,
          config.keyGenerator,
        );
  }

  return config.store === "redis"
    ? redisTokenBucketLimiter(
        config.maxTokens,
        config.refillRatePerSec,
        config.keyGenerator,
      )
    : tokenBucketLimiter(
        config.maxTokens,
        config.refillRatePerSec,
        config.keyGenerator,
      );
}

// Builds a rate-limiting middleware from a plain config object: algorithm,
// storage backend, and limits are all data, so switching any of them for a
// route means changing the config passed in here, not editing this file.
export const createRateLimiter = (config: RateLimiterConfig): Middleware => {
  const algorithm = buildAlgorithm(config);
  const { allowlist, keyGenerator } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (allowlist) {
      const key = keyGenerator ? keyGenerator(req) : (req.ip ?? "unknown");
      if (await isTrustedCaller(key, allowlist)) {
        res.setHeader("X-RateLimit-Bypassed", "true");
        next();
        return;
      }
    }
    algorithm(req, res, next);
  };
};
