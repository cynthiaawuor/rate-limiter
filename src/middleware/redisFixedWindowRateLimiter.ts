import fs from "fs";
import path, { dirname } from "path";
import type { KeyGenerator } from "../types/limiter.js";
import { fileURLToPath } from "url";
import type { NextFunction, Request, Response } from "express";
import { redisClient } from "./redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const luaScript = fs.readFileSync(
  path.join(__dirname, "./fixedWindow.lua"),
  "utf8",
);
export const redisFixedWindowRateLimiter = (
  window_size: number,
  limit: number,
  keyGenerator?: KeyGenerator,
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = keyGenerator ? keyGenerator(req) : (req.ip ?? "unknown");

    const now = Date.now();
    // Namespaced by algorithm + route path so two routes (or a fixed-window
    // and a token-bucket route) never collide on the same Redis key for the
    // same caller — colliding would corrupt counts, and across algorithms
    // it would error, since fixed window stores a string and token bucket a
    // hash under what would otherwise be the identical key.
    const redisKey = `rate_limit:fixedWindow:${req.path}:${key}`;

    const result = (await redisClient.eval(luaScript, {
      keys: [redisKey],
      arguments: [window_size.toString(), limit.toString(), now.toString()],
    })) as [number, number, number];

    const [allowed, remaining, retryAfter] = result;

    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("Retry-After", `${Math.ceil(retryAfter / 1000)}`);

    if (!allowed) {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: `${Math.ceil(retryAfter / 1000)} seconds`,
      });
      return;
    }

    next();
  };
};
