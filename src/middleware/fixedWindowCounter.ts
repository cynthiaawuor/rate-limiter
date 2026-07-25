import type { NextFunction, Request, Response } from "express";
import type { KeyGenerator } from "../types/limiter.js";

/* 
-A map is safe to use with user provided keys and values.
-Performs better in scenarios involving frequent additions and removals of key-value pairs.
*/
const fixedWindowStore = new Map<
  string,
  { count: number; resetTime: number }
>();

export const fixedWindowCounter = (
  windowMs: number,
  limit: number,
  keyGenerator?: KeyGenerator,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const defaultKey = req.ip; //gets the client's IP address
    const key = keyGenerator ? keyGenerator(req) : defaultKey;
    const now = Date.now();
    if (typeof key !== "undefined") {
      let record = fixedWindowStore.get(key);

      // create a new window if no record exists,
      // or if the current time is past the window's reset time,
      if (!record || now > record.resetTime) {
        record = {
          count: 0,
          resetTime: now + windowMs,
        };
      } else {
        record.count++;
      }
      fixedWindowStore.set(key, record);

      //compute headers
      const remainingRequests = Math.max(limit - record.count, 0);

      res.setHeader("X-RateLimit-Remaining", remainingRequests);

      //check if the limit has been exceeded
      if (record.count > limit) {
        const timeToRetry = Math.ceil((record.resetTime - now) / 1000);

        res.setHeader("Retry-after", `${timeToRetry} seconds`);

        res.status(429).json({
          error: "Too many Requests",
          message: `Rate limit exceeded. Try again in ${timeToRetry} seconds`,
        });
        return;
      }
      next();
    }
  };
};

// export const rateLimiter = { fixedWindowCounter, tokenBucketLimiter };
