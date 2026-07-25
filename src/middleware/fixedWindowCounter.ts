import type { NextFunction, Request, Response } from "express";
import type { KeyGenerator } from "../types/limiter.js";

export const fixedWindowCounter = (
  windowMs: number,
  limit: number,
  keyGenerator?: KeyGenerator,
) => {
  // Scoped to this middleware instance, i.e. one store per route. If this
  // were a single module-level Map shared by every fixedWindowCounter(...)
  // call, two routes with different limits would count the same caller
  // against one shared counter and corrupt each other's allowance.
  const fixedWindowStore = new Map<
    string,
    { count: number; resetTime: number }
  >();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator ? keyGenerator(req) : (req.ip ?? "unknown");
    const now = Date.now();

    let record = fixedWindowStore.get(key);

    // create a new window if no record exists,
    // or if the current time is past the window's reset time,
    // this request itself counts as the first request in the window.
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
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

      res.setHeader("Retry-After", `${timeToRetry}`);

      res.status(429).json({
        error: "Too many Requests",
        message: `Rate limit exceeded. Try again in ${timeToRetry} seconds`,
      });
      return;
    }
    next();
  };
};

// export const rateLimiter = { fixedWindowCounter, tokenBucketLimiter };
