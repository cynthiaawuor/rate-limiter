import { describe, it, expect } from "vitest";
import request from "supertest";
import { fixedWindowCounter } from "../src/middleware/fixedWindowCounter.js";
import { tokenBucketLimiter } from "../src/middleware/tokenBucketLimiter.js";
import { redisFixedWindowRateLimiter } from "../src/middleware/redisFixedWindowRateLimiter.js";
import { redisTokenBucketLimiter } from "../src/middleware/redisTokenBucketRateLimiter.js";
import { buildApp, uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

const LIMIT = 10;
const BURST = 50;

async function fireBurst(app: ReturnType<typeof buildApp>, caller: string) {
  const results = await Promise.all(
    Array.from({ length: BURST }, () =>
      request(app).get("/").set("x-caller-id", caller),
    ),
  );
  return results.filter((res) => res.status === 200).length;
}

describe("concurrency: check-and-update must be atomic", () => {
  it("fixed window (memory): a concurrent burst from one caller never admits more than the limit", async () => {
    const app = buildApp(
      fixedWindowCounter(60_000, LIMIT, byHeaderKeyGenerator),
    );
    const admitted = await fireBurst(app, uniqueCallerId());

    expect(admitted).toBe(LIMIT);
  });

  it("token bucket (memory): a concurrent burst from one caller never admits more than capacity", async () => {
    const app = buildApp(tokenBucketLimiter(LIMIT, 1, byHeaderKeyGenerator));
    const admitted = await fireBurst(app, uniqueCallerId());

    expect(admitted).toBe(LIMIT);
  });

  it("fixed window (redis): a concurrent burst from one caller never admits more than the limit", async () => {
    const app = buildApp(
      redisFixedWindowRateLimiter(60, LIMIT, byHeaderKeyGenerator),
    );
    const admitted = await fireBurst(app, uniqueCallerId());

    expect(admitted).toBe(LIMIT);
  });

  it("token bucket (redis): a concurrent burst from one caller never admits more than capacity", async () => {
    const app = buildApp(
      redisTokenBucketLimiter(LIMIT, 1, byHeaderKeyGenerator),
    );
    const admitted = await fireBurst(app, uniqueCallerId());

    expect(admitted).toBe(LIMIT);
  });

  it("sequential and concurrent arrival admit exactly the same number of requests", async () => {
    const sequentialApp = buildApp(
      redisFixedWindowRateLimiter(60, LIMIT, byHeaderKeyGenerator),
    );
    const sequentialCaller = uniqueCallerId();
    let sequentialAdmitted = 0;
    for (let i = 0; i < BURST; i++) {
      const res = await request(sequentialApp)
        .get("/")
        .set("x-caller-id", sequentialCaller);
      if (res.status === 200) sequentialAdmitted++;
    }

    const concurrentApp = buildApp(
      redisFixedWindowRateLimiter(60, LIMIT, byHeaderKeyGenerator),
    );
    const concurrentAdmitted = await fireBurst(concurrentApp, uniqueCallerId());

    expect(sequentialAdmitted).toBe(LIMIT);
    expect(concurrentAdmitted).toBe(LIMIT);
  });

  it("a second concurrent burst after exhausting the limit is rejected outright", async () => {
    const app = buildApp(
      redisFixedWindowRateLimiter(60, LIMIT, byHeaderKeyGenerator),
    );
    const caller = uniqueCallerId();

    const firstBurst = await fireBurst(app, caller);
    const secondBurst = await fireBurst(app, caller);

    expect(firstBurst).toBe(LIMIT);
    expect(secondBurst).toBe(0);
  });
});
