# Rate Limiter Middleware

Express middleware for limiting requests by caller. It supports fixed-window and token-bucket policies, with either process-local memory or Redis as the state store.

## What This Middleware Does

Attach a limiter to an Express application or route to allow a bounded number of requests for each caller. Callers are identified by `req.ip` by default; supply a `keyGenerator` to limit by an API key, user ID, tenant, or another request property.

The `createRateLimiter` factory selects the algorithm and store from one configuration object. Each factory call creates an independent limiter, so routes can have different policies.

## Installation

```sh
npm install
```

Redis-backed limiters require a reachable Redis server. The client reads these optional environment variables (defaults shown):

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

To run the included example server:

```sh
npx tsx src/server.ts
```

It listens on port `5000` by default. Set `PORT`, `RATE_LIMIT`, or `TIME_WINDOW` to change the sample server configuration.

## Running Tests

The full suite includes Redis tests, so start Redis first when running all tests:

```sh
redis-server
npm test
```

If Redis runs elsewhere, set `REDIS_HOST` and `REDIS_PORT` before `npm test`. To run only the in-memory test files, pass their paths to Vitest; for example:

```sh
npx vitest run tests/fixedWindow.memory.test.ts tests/tokenBucket.memory.test.ts
```

## Protecting a Route

Create middleware once, then pass it to Express. This example permits 100 requests per IP in each 60-second window:

```ts
import express from "express";
import { createRateLimiter } from "./middleware/rateLimiter.js";

const app = express();

const apiLimiter = createRateLimiter({
  algorithm: "fixedWindow",
  store: "memory",
  limit: 100,
  windowSeconds: 60,
});

app.get("/api/widgets", apiLimiter, (_req, res) => {
  res.json({ widgets: [] });
});
```

Use `app.use(apiLimiter)` to protect all routes registered after it.

## Configuring Limits Per Route

Give each route its own call to `createRateLimiter`. The configuration is a discriminated union:

- Fixed window: `algorithm: "fixedWindow"`, `limit`, and `windowSeconds`.
- Token bucket: `algorithm: "tokenBucket"`, `maxTokens`, and `refillRatePerSec`.
- Both: `store: "memory" | "redis"` and optional `keyGenerator` and `allowlist`.

For example, a login endpoint can have a tight fixed-window limit while a search endpoint permits a burst and then refills gradually:

```ts
const byApiKey = (req: express.Request) =>
  req.get("x-api-key") ?? req.ip ?? "unknown";

app.post(
  "/login",
  createRateLimiter({
    algorithm: "fixedWindow",
    store: "memory",
    limit: 5,
    windowSeconds: 60,
    keyGenerator: byApiKey,
  }),
  loginHandler,
);

app.get(
  "/search",
  createRateLimiter({
    algorithm: "tokenBucket",
    store: "memory",
    maxTokens: 20,
    refillRatePerSec: 2,
    keyGenerator: byApiKey,
  }),
  searchHandler,
);
```

## Choosing an Algorithm (Token Bucket vs Fixed Window)

Choose a fixed window when the policy is naturally expressed as “N requests per period.” A caller gets up to `limit` requests after its window begins and must wait until that window resets. It is simple and works well for policies such as five login attempts per minute.

Choose a token bucket when short bursts are acceptable but sustained traffic should be controlled. `maxTokens` is the burst capacity and `refillRatePerSec` is the long-term rate. For example, `{ maxTokens: 20, refillRatePerSec: 2 }` allows an initial burst of 20 requests, then approximately two more requests per second.

## The Response Headers

Every evaluated request receives:

```http
X-RateLimit-Remaining: <number>
```

This is the number of fixed-window requests or whole token-bucket tokens left for that caller after the request. It is `0` once the caller is limited and is never negative.

A rejected request has status `429 Too Many Requests` and includes:

```http
Retry-After: <whole seconds>
```

For the in-memory fixed window, this is the time to the current window reset. For a token bucket, it is the time until one token is available. Redis fixed-window middleware also currently sends `Retry-After` on successful responses; clients should treat it as authoritative when the response is `429`.

## In-Memory vs Redis (and the Distributed-State Limitation)

Use `store: "memory"` for local development or a single Node.js process. Its counters and buckets live in a `Map` in that process, require no external service, and are independent per limiter instance.

Use `store: "redis"` when multiple processes, containers, or servers must enforce one shared limit. Redis fixed-window and token-bucket operations execute Lua scripts atomically, so concurrent requests do not race while checking and updating the shared state.

In-memory state is not distributed. If four application instances sit behind a load balancer, each can admit up to the configured allowance for the same caller. A client may therefore receive roughly four times the intended total, depending on routing. Use Redis for a global limit across instances.

Here is a Redis-backed route shared by all instances using the same Redis database:

```ts
app.post(
  "/events",
  createRateLimiter({
    algorithm: "tokenBucket",
    store: "redis",
    maxTokens: 20,
    refillRatePerSec: 5,
  }),
  createEvent,
);
```

## Running the Concurrency Tests

The concurrency simulation sends a burst of 50 simultaneous requests for one caller and verifies that no more than the configured limit is admitted. It covers both memory and Redis implementations, so Redis must be running:

```sh
redis-server
npx vitest run tests/concurrency.test.ts
```

The expected result is that each burst admits exactly the configured number of requests and returns `429` for the remainder.

## The Allowlist

An allowlist bypasses rate limiting for trusted caller keys. It is available only through `createRateLimiter`; when a caller matches, the request proceeds with `X-RateLimit-Bypassed: true`.

Use the same key format in the allowlist as the limiter’s `keyGenerator`. Memory allowlists are shared only inside one process; Redis allowlists are shared by instances using the same Redis database and can be updated at runtime.

```ts
import {
  addTrustedCaller,
  removeTrustedCaller,
} from "./middleware/allowlist.js";

const trustedPartners = { store: "redis" } as const;
const byApiKey = (req: express.Request) => req.get("x-api-key") ?? "anonymous";

app.get(
  "/partner-feed",
  createRateLimiter({
    algorithm: "fixedWindow",
    store: "redis",
    limit: 60,
    windowSeconds: 60,
    keyGenerator: byApiKey,
    allowlist: trustedPartners,
  }),
  partnerFeed,
);

await addTrustedCaller("partner-api-key", trustedPartners);
await removeTrustedCaller("partner-api-key", trustedPartners);
```

Protect any endpoint that changes the allowlist. The sample server demonstrates admin endpoints guarded by `ADMIN_API_KEY`.

## Known Limitations

- The middleware uses the request IP by default. If the app is behind a reverse proxy, configure Express proxy trust correctly or provide a stable `keyGenerator`.
- In-memory counters are process-local and are lost when the process restarts. They are not suitable for a shared deployment.
- The in-memory stores do not proactively remove inactive caller entries; applications with many distinct callers should prefer Redis or add lifecycle management.
- Redis availability is part of the request path for Redis-backed policies. A Redis connection or command failure can prevent the limiter from making a decision; the Redis token-bucket middleware currently responds with HTTP 500 on command errors.
- The Redis fixed-window implementation currently divides Redis's TTL value by 1,000 before setting `Retry-After`, even though Redis returns that TTL in seconds. Its retry value is therefore not reliable for normal window durations.
- Configuration values are assumed to be valid positive numbers; this package does not currently validate them at construction time.
