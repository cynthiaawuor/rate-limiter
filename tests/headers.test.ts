import { describe, it, expect } from "vitest";
import request from "supertest";
import { fixedWindowCounter } from "../src/middleware/fixedWindowCounter.js";
import { tokenBucketLimiter } from "../src/middleware/tokenBucketLimiter.js";
import { buildApp, uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

describe("HTTP contract: 429 + rate-limit headers", () => {
  it("allowed requests are never given a 429", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 3, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    const res = await request(app).get("/").set("x-caller-id", caller);

    expect(res.status).not.toBe(429);
  });

  it("rejected requests respond with exactly HTTP 429", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const res = await request(app).get("/").set("x-caller-id", caller);

    expect(res.status).toBe(429);
  });

  it("fixed window: Retry-After reflects seconds remaining until window reset", async () => {
    const windowMs = 5_000;
    const app = buildApp(
      fixedWindowCounter(windowMs, 1, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const res = await request(app).get("/").set("x-caller-id", caller);

    const retryAfter = Number(res.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowMs / 1000);
  });

  it("token bucket: Retry-After reflects seconds until the next token refills", async () => {
    const refillRatePerSec = 2;
    const app = buildApp(
      tokenBucketLimiter(1, refillRatePerSec, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const res = await request(app).get("/").set("x-caller-id", caller);

    // Empty bucket, 2 tokens/sec -> next token in <= 0.5s, so Retry-After
    // (rounded up to whole seconds) must be exactly 1.
    expect(res.headers["retry-after"]).toBe("1");
  });

  it("X-RateLimit-Remaining decreases by one per allowed request", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 3, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    const first = await request(app).get("/").set("x-caller-id", caller);
    const second = await request(app).get("/").set("x-caller-id", caller);
    const third = await request(app).get("/").set("x-caller-id", caller);

    expect(first.headers["x-ratelimit-remaining"]).toBe("2");
    expect(second.headers["x-ratelimit-remaining"]).toBe("1");
    expect(third.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("X-RateLimit-Remaining is 0, never negative, once rejected", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const rejectedOne = await request(app)
      .get("/")
      .set("x-caller-id", caller);
    const rejectedTwo = await request(app)
      .get("/")
      .set("x-caller-id", caller);

    expect(rejectedOne.headers["x-ratelimit-remaining"]).toBe("0");
    expect(rejectedTwo.headers["x-ratelimit-remaining"]).toBe("0");
  });
});
