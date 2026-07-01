# Rate Limiter Middleware

Express middleware for request rate limiting. This repo includes two algorithms, each with an in-memory implementation and a Redis-backed implementation:

- Fixed window counter: counts requests for a key inside a fixed time window.
- Token bucket: spends one token per request and refills tokens over time.

By default, each middleware keys requests by `req.ip`. You can pass a custom `keyGenerator` to limit by user id, API key, tenant id, or any other request-derived identifier.

## Install And Run

```sh
git clone git@github.com:cynthiaawuor/rate-limiter.git
npm install
npx tsx src/server.ts
```

The sample server listens on `localhost:5000`.

Redis-backed limiters connect to:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

Start Redis before using `redisFixedWindowRateLimiter` or `redisTokenBucketLimiter`.

## Algorithms And Options

### In-memory fixed window

```ts
fixedWindowCounter(windowMs, limit, keyGenerator?)
```

- `windowMs`: window length in milliseconds.
- `limit`: maximum number of requests allowed in the window.
- `keyGenerator`: optional function `(req) => string`.

This stores counters in a process-local `Map`.

### In-memory token bucket

```ts
tokenBucketLimiter(maxTokens, refillRatePerSec, keyGenerator?)
```

- `maxTokens`: bucket capacity and initial token count.
- `refillRatePerSec`: number of tokens added per second.
- `keyGenerator`: optional function `(req) => string`.

This stores bucket state in a process-local `Map`.

### Redis fixed window

```ts
redisFixedWindowRateLimiter(windowSizeSeconds, limit, keyGenerator?)
```

- `windowSizeSeconds`: window length in seconds.
- `limit`: maximum number of requests allowed in the window.
- `keyGenerator`: optional function `(req) => string`.

The middleware runs `src/middleware/fixedWindow.lua` with Redis `EVAL`, so checking and incrementing the request count happen atomically in Redis.

### Redis token bucket

```ts
redisTokenBucketLimiter(maxTokens, refillRatePerSec, keyGenerator?)
```

- `maxTokens`: bucket capacity and initial token count.
- `refillRatePerSec`: number of tokens added per second.
- `keyGenerator`: optional function `(req) => string`.

The middleware runs `src/middleware/tokenBucket.lua` with Redis `EVAL`, so token refill, spend, and retry calculation happen atomically in Redis.

## Usage Examples

### 1. Protect every route with an in-memory fixed window

```ts
import express from "express";
import { fixedWindowCounter } from "./middleware/fixedWindowCounter.js";

const app = express();

// Allow 100 requests per IP every 60 seconds.
app.use(fixedWindowCounter(60000, 100));

app.get("/login", (_req, res) => {
  res.json({ ok: true });
});
```

### 2. Protect one route with an in-memory token bucket

```ts
import express from "express";
import { tokenBucketLimiter } from "./middleware/tokenBucketLimiter.js";

const app = express();

// Allow bursts of 10 requests, then refill 2 requests per second.
app.post("/login", tokenBucketLimiter(10, 2), (req, res) => {
  res.json({ status: "login accepted" });
});
```

### 3. Limit by API key instead of IP

```ts
import express from "express";
import { fixedWindowCounter } from "./middleware/fixedWindowCounter.js";

const app = express();

const apiKey = (req: Request) =>
  req.header("x-api-key") ?? req.ip";

// Allow 500 requests per API key every 5 minutes.
app.get("/", fixedWindowCounter(300_000, 500, apiKey), (_req, res) => {
  res.json({ reports: [] });
});
```

### 4. Use Redis for shared limits across app instances

```ts
import express from "express";
import { redisFixedWindowRateLimiter } from "./middleware/redisFixedWindowRateLimiter.js";
import { redisTokenBucketLimiter } from "./middleware/redisTokenBucketRateLimiter.js";

const app = express();

// 60 requests per IP per minute, shared through Redis.
app.get("/events", redisFixedWindowRateLimiter(60, 60), (_req, res) => {
  res.json({ results: [] });
});

// Bursts of 20 requests, refilling 5 requests per second, shared through Redis.
app.post("/events", redisTokenBucketLimiter(20, 5), (_req, res) => {
  res.status(202);
});
```

## Response Headers

All limiters set:

```http
X-RateLimit-Remaining: <number>
```

`X-RateLimit-Remaining` is the number of requests or whole tokens remaining for the current key after the current request is evaluated.

When a request is rejected with `429 Too Many Requests`, the middleware also sets a retry header:

```http
Retry-After: <seconds>
```

Implementation notes:

- `tokenBucketLimiter` and `redisTokenBucketLimiter` use `Retry-After`.
- `fixedWindowCounter` currently emits `Retry-after` with a lowercase `a`.
- `redisFixedWindowRateLimiter` currently sets `Retry-After` on every response and formats the value as text such as `1 second(s)`.

Rejected responses are JSON. Fixed window responses use a "too many requests" error with a retry value; token bucket responses report that the bucket is empty.

## In-memory Vs Redis State

Use the in-memory middleware for local development, single-process apps, and simple services where each Node.js process can enforce its own independent limit.

Use the Redis middleware when multiple Node.js processes, containers, or servers must share one rate-limit state. The Redis versions keep counters and token bucket state in Redis and execute Lua scripts atomically, which prevents concurrent requests from racing each other inside Redis.

Distributed-state limitation: the in-memory limiters are not distributed. If you run four app instances behind a load balancer, each instance has its own `Map`, so a client can effectively receive up to four times the intended allowance depending on routing. Use Redis when the limit must apply globally across instances.

## Testing And Concurrency Simulation

The current `package.json` has a placeholder `npm test` script and no automated test suite is wired yet. Use the following developer checks until a test runner is added.

Run the sample server:

```sh
npx tsx src/server.ts
```

Smoke test the global fixed-window limiter in `src/server.ts`:
For this example, i used postman and setting the number of iterations as needed.

```sh
GET  http://localhost:5000/
```

Smoke test the Redis fixed-window route. Make sure Redis is running first:

```sh
GET http://localhost:5000/login
```

You should see successful responses until the configured limit is exhausted, followed by `429` responses while the key remains limited.
