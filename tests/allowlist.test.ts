import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimiter } from "../src/middleware/rateLimiter.js";
import {
  addTrustedCaller,
  removeTrustedCaller,
} from "../src/middleware/allowlist.js";
import { uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

describe("trusted-caller allowlist (bypass)", () => {
  it("a trusted caller bypasses the limit entirely", async () => {
    const app = express();
    app.get(
      "/",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();
    await addTrustedCaller(caller, { store: "memory" });

    let allAllowed = true;
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/").set("x-caller-id", caller);
      if (res.status !== 200) allAllowed = false;
    }

    expect(allAllowed).toBe(true);
  });

  it("a caller not on the allowlist is still limited normally", async () => {
    const app = express();
    app.get(
      "/",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const rejected = await request(app).get("/").set("x-caller-id", caller);

    expect(rejected.status).toBe(429);
  });

  it("adding a caller at runtime takes effect on the very next request, no restart required", async () => {
    const app = express();
    app.get(
      "/",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const rejectedBeforeTrust = await request(app)
      .get("/")
      .set("x-caller-id", caller);
    expect(rejectedBeforeTrust.status).toBe(429);

    await addTrustedCaller(caller, { store: "memory" });

    const allowedAfterTrust = await request(app)
      .get("/")
      .set("x-caller-id", caller);
    expect(allowedAfterTrust.status).toBe(200);
    expect(allowedAfterTrust.headers["x-ratelimit-bypassed"]).toBe("true");
  });

  it("removing a caller at runtime re-applies the limit on the next request", async () => {
    const app = express();
    app.get(
      "/",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();
    await addTrustedCaller(caller, { store: "memory" });

    await request(app).get("/").set("x-caller-id", caller);
    await removeTrustedCaller(caller, { store: "memory" });

    // The bypassed request above never touched the counter, so the caller
    // still has their full, untouched allowance of 1 once trust is revoked.
    const firstCounted = await request(app)
      .get("/")
      .set("x-caller-id", caller);
    const rejected = await request(app).get("/").set("x-caller-id", caller);

    expect(firstCounted.status).toBe(200);
    expect(rejected.status).toBe(429);
  });

  it("a Redis-backed allowlist is shared across separate middleware instances", async () => {
    const config = {
      algorithm: "fixedWindow" as const,
      store: "memory" as const,
      limit: 1,
      windowSeconds: 60,
      keyGenerator: byHeaderKeyGenerator,
      allowlist: { store: "redis" as const },
    };
    const instanceA = express();
    instanceA.get("/", createRateLimiter(config), (_req, res) =>
      res.json({ ok: true }),
    );
    const instanceB = express();
    instanceB.get("/", createRateLimiter(config), (_req, res) =>
      res.json({ ok: true }),
    );
    const caller = uniqueCallerId();
    await addTrustedCaller(caller, { store: "redis" });

    let allAllowed = true;
    for (let i = 0; i < 3; i++) {
      const resA = await request(instanceA)
        .get("/")
        .set("x-caller-id", caller);
      const resB = await request(instanceB)
        .get("/")
        .set("x-caller-id", caller);
      if (resA.status !== 200 || resB.status !== 200) allAllowed = false;
    }

    expect(allAllowed).toBe(true);
  });

  it("the bypass applies to both algorithms", async () => {
    const app = express();
    app.get(
      "/fixed",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    app.get(
      "/token",
      createRateLimiter({
        algorithm: "tokenBucket",
        store: "memory",
        maxTokens: 1,
        refillRatePerSec: 1,
        keyGenerator: byHeaderKeyGenerator,
        allowlist: { store: "memory" },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();
    await addTrustedCaller(caller, { store: "memory" });

    let fixedAllowed = true;
    let tokenAllowed = true;
    for (let i = 0; i < 3; i++) {
      const fixedRes = await request(app)
        .get("/fixed")
        .set("x-caller-id", caller);
      const tokenRes = await request(app)
        .get("/token")
        .set("x-caller-id", caller);
      if (fixedRes.status !== 200) fixedAllowed = false;
      if (tokenRes.status !== 200) tokenAllowed = false;
    }

    expect(fixedAllowed).toBe(true);
    expect(tokenAllowed).toBe(true);
  });
});
