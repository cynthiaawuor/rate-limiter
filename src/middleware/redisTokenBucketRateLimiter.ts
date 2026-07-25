import type { NextFunction, Request, Response } from "express";
import fs from "fs";
import path, { dirname } from "path";
import type { KeyGenerator } from "../types/limiter.js";
import { fileURLToPath } from "url";
import { redisClient } from "./redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const luaScript = fs.readFileSync(
  path.join(__dirname, "./tokenBucket.lua"),
  "utf8",
);

export const redisTokenBucketLimiter = (
  maxTokens: number,
  refillRatePerSec: number,
  keyGenerator?: KeyGenerator,
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = keyGenerator ? keyGenerator(req) : (req.ip ?? "unknown");
    const now = Date.now();
    // Namespaced by algorithm + route path — see redisFixedWindowRateLimiter
    // for why (avoids cross-route and cross-algorithm key collisions).
    const redisKey = `rate_limit:tokenBucket:${req.path}:${key}`;

    try {
      // Execute the Lua script atomically in Redis
      const result = (await redisClient.eval(luaScript, {
        keys: [redisKey],
        arguments: [
          maxTokens.toString(),
          refillRatePerSec.toString(),
          now.toString(), // Pass current time to ensure sync across nodes
        ],
      })) as [number, string, string];

      // Destructure the array returned by Lua
      const [allowed, remainingTokensStr, retryAfterStr] = result;

      const remainingTokens = parseFloat(remainingTokensStr);
      const retryAfter = parseInt(retryAfterStr, 10);

      if (allowed === 1) {
        // Allowed: send remaining tokens
        res.setHeader("X-RateLimit-Remaining", Math.floor(remainingTokens));
        next();
      } else {
        // Rejected: enforce limits
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("Retry-After", retryAfter);
        res.status(429).json({
          error: "Too Many Requests",
          message: `Bucket empty. Try again in ${retryAfter} seconds.`,
        });
      }
    } catch (error) {
      console.error("Redis Rate Limiter Error:", error);
      res
        .status(500)
        .json({ message: "Internal server error during rate limiting" });
    }
  };
};
