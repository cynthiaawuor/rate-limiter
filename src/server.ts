import "dotenv/config";
import express from "express";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import {
  addTrustedCaller,
  removeTrustedCaller,
  listTrustedCallers,
} from "./middleware/allowlist.js";
import type { AllowlistConfig } from "./middleware/allowlist.js";

const app = express();
app.use(express.json());
const PORT = Number(process.env.PORT) || 5000;

// Trusted callers are stored in Redis so the allowlist is shared by every
// instance and can be updated live via /admin/allowlist below, without a
// restart or redeploy.
const allowlist: AllowlistConfig = { store: "redis" };

const limiter = createRateLimiter({
  algorithm: "fixedWindow",
  store: "memory",
  limit: Number(process.env.RATE_LIMIT) || 5,
  windowSeconds: Number(process.env.TIME_WINDOW) || 60,
});

const loginLimiter = createRateLimiter({
  algorithm: "fixedWindow",
  store: "redis",
  limit: 5,
  windowSeconds: 60,
  allowlist,
});

app.use(limiter);

app.get("/", (_req, res) => {
  res.send("welcome TO THE RATE LIMITER");
});

app.get("/login", loginLimiter, (_req, res) => {
  res.send("Redis Fixed Window Rate Limiter");
});

// Lets an operator exempt a caller from rate limiting at runtime, e.g. a
// partner whose integration legitimately needs a higher ceiling. Guarded by
// a shared secret so this isn't an open door to bypass every limit.
const requireAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || req.get("x-admin-key") !== adminKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

app.post("/admin/allowlist", requireAdmin, async (req, res) => {
  const { key } = req.body as { key?: string };
  if (!key) {
    res.status(400).json({ error: "key is required" });
    return;
  }
  await addTrustedCaller(key, allowlist);
  res.status(201).json({ trusted: key });
});

app.delete("/admin/allowlist/:key", requireAdmin, async (req, res) => {
  const { key } = req.params as { key: string };
  await removeTrustedCaller(key, allowlist);
  res.status(204).send();
});

app.get("/admin/allowlist", requireAdmin, async (_req, res) => {
  res.json({ trusted: await listTrustedCallers(allowlist) });
});

app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`Server listening on localhost:${PORT}`);
});
