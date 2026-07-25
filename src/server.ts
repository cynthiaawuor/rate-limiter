import "dotenv/config";
import express from "express";
import { tokenBucketLimiter } from "./middleware/tokenBucketLimiter.js";
import { fixedWindowCounter } from "./middleware/fixedWindowCounter.js";
import { redisTokenBucketLimiter } from "./middleware/redisTokenBucketRateLimiter.js";
import { redisFixedWindowRateLimiter } from "./middleware/redisFixedWindowRateLimiter.js";

const app = express();
app.use(express.json());
const PORT = 5000;

const limiter = fixedWindowCounter(3, 3);
// const redisTokenLimiter = redisTokenBucketLimiter(3, 1);
const redisFixedWindowLimiter = redisFixedWindowRateLimiter(10, 5);

app.use(limiter);
// app.use(redisLimiter);

app.get("/", (req, res) => {
  res.send("welcome TO THE RATE LIMITER");
});

// app.get("/login", tokenBucketLimiter(1, 2));
app.get("/login", redisFixedWindowLimiter, (req, res) => {
  res.send("Redis Fixed Window Rate Limiter");
});

app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`Server listening on localhost:${PORT}`);
});
