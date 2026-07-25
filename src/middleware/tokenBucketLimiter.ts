import type { NextFunction, Request, Response } from "express";
import type { KeyGenerator } from "../types/limiter.js";

const tokenBucketStore = new Map<
  string,
  { tokens: number; lastRefill: number }
>();
export const tokenBucketLimiter = (
  maxTokens: number,
  refillRatePerSec: number,
  keyGenerator?: KeyGenerator,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const defaultKey = req.ip;
    const key = keyGenerator ? keyGenerator(req) : defaultKey;

    if (typeof key !== "undefined") {
      //first request starts with full capacity
      let record = tokenBucketStore.get(key);
      const now = Date.now();
      if (!record) {
        record = { tokens: maxTokens, lastRefill: now };
      } else {
        // Lazy refill: calculate how many seconds have passed
        const elapsedSec = (now - record.lastRefill) / 1000;
        const newTokens = elapsedSec * refillRatePerSec;

        // Add tokens up to the maximum capacity, and update the time
        record.tokens = Math.min(record.tokens + newTokens, maxTokens);
        record.lastRefill = now;
      }
      if (record.tokens >= 1) {
        //reduce the number of tokens by 1
        record.tokens -= 1;
        tokenBucketStore.set(key, record);
        res.setHeader("X-RateLimit-Remaining", record.tokens);
        next();
      } else {
        //Reject request
        tokenBucketStore.set(key, record);

        // Calculate time needed to generate 1 full token
        const tokensNeeded = 1 - record.tokens;
        const timeLeft = Math.ceil(tokensNeeded / refillRatePerSec);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("Retry-After", timeLeft);
        res.status(429).json({
          error: "Too Many Requests",
          message: `Bucket empty. Try again in ${timeLeft} seconds.`,
        });
        return;
      }
    }
  };
};
