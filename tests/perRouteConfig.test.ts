import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createRateLimiter } from "../src/middleware/rateLimiter.js";
import { uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

describe("per-route configuration", () => {
  it("different routes run different algorithms at the same time", async () => {
    const app = express();
    app.get(
      "/fixed",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
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
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();

    const fixedFirst = await request(app)
      .get("/fixed")
      .set("x-caller-id", caller);
    const fixedSecond = await request(app)
      .get("/fixed")
      .set("x-caller-id", caller);
    const tokenFirst = await request(app)
      .get("/token")
      .set("x-caller-id", caller);
    const tokenSecond = await request(app)
      .get("/token")
      .set("x-caller-id", caller);

    expect(fixedFirst.status).toBe(200);
    expect(fixedSecond.status).toBe(429);
    expect(tokenFirst.status).toBe(200);
    expect(tokenSecond.status).toBe(429);
  });

  it("different routes enforce independent limit values", async () => {
    const app = express();
    app.get(
      "/strict",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    app.get(
      "/lenient",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 10,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();

    await request(app).get("/strict").set("x-caller-id", caller);
    const strictRejected = await request(app)
      .get("/strict")
      .set("x-caller-id", caller);

    let lenientAllowed = 0;
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get("/lenient")
        .set("x-caller-id", caller);
      if (res.status === 200) lenientAllowed++;
    }

    expect(strictRejected.status).toBe(429);
    expect(lenientAllowed).toBe(10);
  });

  it("the same factory produces independently-behaving limiters purely from config", async () => {
    const configA = createRateLimiter({
      algorithm: "fixedWindow",
      store: "memory",
      limit: 2,
      windowSeconds: 60,
      keyGenerator: byHeaderKeyGenerator,
    });
    const configB = createRateLimiter({
      algorithm: "fixedWindow",
      store: "memory",
      limit: 5,
      windowSeconds: 60,
      keyGenerator: byHeaderKeyGenerator,
    });
    const appA = express();
    appA.get("/", configA, (_req, res) => res.json({ ok: true }));
    const appB = express();
    appB.get("/", configB, (_req, res) => res.json({ ok: true }));
    const caller = uniqueCallerId();

    let allowedA = 0;
    for (let i = 0; i < 3; i++) {
      const res = await request(appA).get("/").set("x-caller-id", caller);
      if (res.status === 200) allowedA++;
    }
    let allowedB = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(appB).get("/").set("x-caller-id", caller);
      if (res.status === 200) allowedB++;
    }

    expect(allowedA).toBe(2);
    expect(allowedB).toBe(5);
  });

  it("the storage backend is selectable via configuration alone", async () => {
    const memoryLimiter = createRateLimiter({
      algorithm: "fixedWindow",
      store: "memory",
      limit: 2,
      windowSeconds: 60,
      keyGenerator: byHeaderKeyGenerator,
    });
    const redisLimiter = createRateLimiter({
      algorithm: "fixedWindow",
      store: "redis",
      limit: 2,
      windowSeconds: 60,
      keyGenerator: byHeaderKeyGenerator,
    });
    const app = express();
    app.get("/memory", memoryLimiter, (_req, res) => res.json({ ok: true }));
    app.get("/redis", redisLimiter, (_req, res) => res.json({ ok: true }));
    const caller = uniqueCallerId();

    const memoryRes = await request(app)
      .get("/memory")
      .set("x-caller-id", caller);
    const redisRes = await request(app)
      .get("/redis")
      .set("x-caller-id", caller);

    expect(memoryRes.status).toBe(200);
    expect(redisRes.status).toBe(200);
  });

  it("a route configured with limit=1 rejects on the very next request", async () => {
    const app = express();
    app.get(
      "/",
      createRateLimiter({
        algorithm: "fixedWindow",
        store: "memory",
        limit: 1,
        windowSeconds: 60,
        keyGenerator: byHeaderKeyGenerator,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const caller = uniqueCallerId();

    const first = await request(app).get("/").set("x-caller-id", caller);
    const second = await request(app).get("/").set("x-caller-id", caller);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});
