import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { tokenBucketLimiter } from "../src/middleware/tokenBucketLimiter.js";
import { buildApp, uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

describe("token bucket (in-memory)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows a request when a token is available and consumes one token", async () => {
    const app = buildApp(tokenBucketLimiter(2, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    const res = await request(app).get("/").set("x-caller-id", caller);

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-remaining"]).toBe("1");
  });

  it("rejects a request once the bucket is empty", async () => {
    const app = buildApp(tokenBucketLimiter(1, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const res = await request(app).get("/").set("x-caller-id", caller);

    expect(res.status).toBe(429);
  });

  it("refills tokens over elapsed time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const app = buildApp(tokenBucketLimiter(1, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    await request(app).get("/").set("x-caller-id", caller);
    const empty = await request(app).get("/").set("x-caller-id", caller);
    expect(empty.status).toBe(429);

    // 1 second later, 1 token/sec refill rate means exactly one token back.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 1_000);
    const refilled = await request(app).get("/").set("x-caller-id", caller);
    expect(refilled.status).toBe(200);
  });

  it("allows a caller that has been idle to burst up to capacity", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const app = buildApp(tokenBucketLimiter(5, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    // Idle long enough to be fully (but not over-) refilled.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 10_000);

    let allowed = 0;
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/").set("x-caller-id", caller);
      if (res.status === 200) allowed++;
    }
    const overflow = await request(app).get("/").set("x-caller-id", caller);

    expect(allowed).toBe(5);
    expect(overflow.status).toBe(429);
  });

  it("cannot exceed the configured refill rate over time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const app = buildApp(tokenBucketLimiter(2, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    // Drain the initial burst capacity.
    await request(app).get("/").set("x-caller-id", caller);
    await request(app).get("/").set("x-caller-id", caller);

    // Only 1.5s pass -> at most 1 whole token should be available, never 2.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 1_500);
    const first = await request(app).get("/").set("x-caller-id", caller);
    const second = await request(app).get("/").set("x-caller-id", caller);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it("capacity and refill rate are independently configurable per instance", async () => {
    const small = buildApp(tokenBucketLimiter(1, 1, byHeaderKeyGenerator));
    const large = buildApp(tokenBucketLimiter(4, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    let largeAllowed = 0;
    for (let i = 0; i < 4; i++) {
      const res = await request(large).get("/").set("x-caller-id", caller);
      if (res.status === 200) largeAllowed++;
    }
    const smallSecond = await (async () => {
      await request(small).get("/").set("x-caller-id", caller);
      return request(small).get("/").set("x-caller-id", caller);
    })();

    expect(largeAllowed).toBe(4);
    expect(smallSecond.status).toBe(429);
  });
});
