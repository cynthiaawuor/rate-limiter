import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { redisFixedWindowRateLimiter } from "../src/middleware/redisFixedWindowRateLimiter.js";
import { redisTokenBucketLimiter } from "../src/middleware/redisTokenBucketRateLimiter.js";
import { buildApp, uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

// These tests need a real Redis instance reachable at REDIS_HOST:REDIS_PORT
// (defaults to localhost:6379) — see README for how to start one.
describe("Redis-backed store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fixed window (redis): allows up to the limit, rejects beyond it", async () => {
    const app = buildApp(
      redisFixedWindowRateLimiter(60, 3, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/").set("x-caller-id", caller);
      expect(res.status).toBe(200);
    }
    const rejected = await request(app).get("/").set("x-caller-id", caller);
    expect(rejected.status).toBe(429);
  });

  it("fixed window (redis): allowance resets once the window's TTL elapses", async () => {
    const app = buildApp(
      redisFixedWindowRateLimiter(1, 1, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    const first = await request(app).get("/").set("x-caller-id", caller);
    const rejected = await request(app).get("/").set("x-caller-id", caller);

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const afterReset = await request(app).get("/").set("x-caller-id", caller);

    expect(first.status).toBe(200);
    expect(rejected.status).toBe(429);
    expect(afterReset.status).toBe(200);
  }, 10_000);

  it("token bucket (redis): allows a request and consumes a token, then rejects when empty", async () => {
    const app = buildApp(
      redisTokenBucketLimiter(1, 1, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    const first = await request(app).get("/").set("x-caller-id", caller);
    const second = await request(app).get("/").set("x-caller-id", caller);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it("token bucket (redis): refills lazily based on elapsed time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const app = buildApp(
      redisTokenBucketLimiter(1, 1, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const empty = await request(app).get("/").set("x-caller-id", caller);
    expect(empty.status).toBe(429);

    vi.spyOn(Date, "now").mockReturnValue(2_000_000 + 1_000);
    const refilled = await request(app).get("/").set("x-caller-id", caller);
    expect(refilled.status).toBe(200);
  });

  it("separate middleware instances (simulating separate service instances) share the same count for a caller", async () => {
    // Two independently constructed middlewares, as if running on two
    // different app instances behind a load balancer — this is exactly what
    // REQ-008 requires: the count is global because both point at the same
    // Redis key, not process-local.
    const instanceA = buildApp(
      redisFixedWindowRateLimiter(60, 3, byHeaderKeyGenerator),
    );
    const instanceB = buildApp(
      redisFixedWindowRateLimiter(60, 3, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    const onA1 = await request(instanceA).get("/").set("x-caller-id", caller);
    const onB1 = await request(instanceB).get("/").set("x-caller-id", caller);
    const onA2 = await request(instanceA).get("/").set("x-caller-id", caller);
    const onB2 = await request(instanceB).get("/").set("x-caller-id", caller);

    expect(onA1.status).toBe(200);
    expect(onB1.status).toBe(200);
    expect(onA2.status).toBe(200);
    // 4th request overall against a limit of 3 must be rejected, proving the
    // two "instances" are not counting independently.
    expect(onB2.status).toBe(429);
  });

  it("both algorithms can run against the Redis-backed store", async () => {
    const fixedApp = buildApp(
      redisFixedWindowRateLimiter(60, 1, byHeaderKeyGenerator),
    );
    const tokenApp = buildApp(
      redisTokenBucketLimiter(1, 1, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    const fixedRes = await request(fixedApp)
      .get("/")
      .set("x-caller-id", caller);
    const tokenRes = await request(tokenApp)
      .get("/")
      .set("x-caller-id", caller);

    expect(fixedRes.status).toBe(200);
    expect(tokenRes.status).toBe(200);
  });
});
