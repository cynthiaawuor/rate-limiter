import express from "express";
import type { RequestHandler } from "express";
import type { KeyGenerator } from "../src/types/limiter.js";

export function buildApp(...middleware: RequestHandler[]) {
  const app = express();
  app.use(...middleware);
  app.get("/", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

// Every test gets its own caller id so tests never share state through the
// module-level in-memory Maps or a shared Redis instance.
let counter = 0;
export function uniqueCallerId(prefix = "caller"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

// Identifies callers by an "x-caller-id" header so tests can simulate
// multiple distinct callers against the same app without depending on
// varying the loopback source IP.
export const byHeaderKeyGenerator: KeyGenerator = (req) =>
  req.header("x-caller-id") ?? (req.ip as string) ?? "unknown";
