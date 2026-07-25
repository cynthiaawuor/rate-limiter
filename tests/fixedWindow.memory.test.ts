import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { fixedWindowCounter } from "../src/middleware/fixedWindowCounter.js";
import { buildApp, uniqueCallerId, byHeaderKeyGenerator } from "./helpers.js";

describe("fixed window counter (in-memory)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests up to the configured limit", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 3, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get("/").set("x-caller-id", caller);
      expect(res.status).toBe(200);
    }
  });

  it("rejects the request that exceeds the limit", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 3, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    for (let i = 0; i < 3; i++) {
      await request(app).get("/").set("x-caller-id", caller);
    }
    const res = await request(app).get("/").set("x-caller-id", caller);

    expect(res.status).toBe(429);
  });

  it("resets the allowance once the window elapses", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const app = buildApp(fixedWindowCounter(1_000, 1, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    const first = await request(app).get("/").set("x-caller-id", caller);
    const secondSameWindow = await request(app)
      .get("/")
      .set("x-caller-id", caller);

    expect(first.status).toBe(200);
    expect(secondSameWindow.status).toBe(429);

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 1_001);
    const afterReset = await request(app).get("/").set("x-caller-id", caller);

    expect(afterReset.status).toBe(200);
  });

  it("tracks separate callers under separate keys", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 1, byHeaderKeyGenerator));
    const callerA = uniqueCallerId("a");
    const callerB = uniqueCallerId("b");

    const resA = await request(app).get("/").set("x-caller-id", callerA);
    const resB = await request(app).get("/").set("x-caller-id", callerB);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it("uses req.ip as the default caller key when no keyGenerator is given", async () => {
    const app = buildApp(fixedWindowCounter(60_000, 1));

    const first = await request(app).get("/");
    const second = await request(app).get("/");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it("the limit and window size are configurable per instance", async () => {
    const strict = buildApp(fixedWindowCounter(60_000, 1, byHeaderKeyGenerator));
    const lenient = buildApp(fixedWindowCounter(60_000, 5, byHeaderKeyGenerator));
    const caller = uniqueCallerId();

    await request(strict).get("/").set("x-caller-id", caller);
    const strictSecond = await request(strict)
      .get("/")
      .set("x-caller-id", caller);

    let lenientAllowed = 0;
    for (let i = 0; i < 5; i++) {
      const res = await request(lenient).get("/").set("x-caller-id", caller);
      if (res.status === 200) lenientAllowed++;
    }

    expect(strictSecond.status).toBe(429);
    expect(lenientAllowed).toBe(5);
  });
});
