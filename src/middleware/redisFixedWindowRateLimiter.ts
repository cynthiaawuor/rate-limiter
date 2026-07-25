import { createClient } from "redis";
import fs from "fs";
import path, { dirname } from "path";
import type { KeyGenerator } from "../types/limiter.js";
import { fileURLToPath } from "url";
import type { NextFunction, Request, Response } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`,
});
redisClient.connect().catch(console.error);

const luaScript = fs.readFileSync(
  path.join(__dirname, "./fixedWindow.lua"),
  "utf8",
);
export const redisFixedWindowRateLimiter = (
  window_size: number,
  limit: number,
  keyGenerator?: KeyGenerator,
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const defaultKey = req.ip;
    const key = keyGenerator ? keyGenerator(req) : defaultKey;

    const now = Date.now();

    const result = (await redisClient.eval(luaScript, {
      keys: [`rate_limit:${key}`],
      arguments: [window_size.toString(), limit.toString(), now.toString()],
    })) as [number, number, number];

    const [allowed, remaining, retryAfter] = result;

    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("Retry-After", `${Math.ceil(retryAfter / 1000)} second(s)`);

    if (!allowed) {
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: `${Math.ceil(retryAfter / 1000)} seconds`,
      });
    }

    next();
  };
};
