import "dotenv/config";
import express from "express";
import { tokenBucketLimiter } from "./middleware/tokenBucketLimiter.js";
import { fixedWindowCounter } from "./middleware/fixedWindowCounter.js";
import { redisTokenBucketLimiter } from "./middleware/redis-rate-limiter.js";

const app = express();
app.use(express.json());
const PORT = 5000;

const limiter = fixedWindowCounter(3 * 1000, 3);
// const redisLimiter = redisTokenBucketLimiter(3, 1);

app.use(limiter);
// app.use(redisLimiter);

app.get("/", (req, res) => {
  res.send("welcome TO THE RATE LIMITER");
});

// app.get("/login", tokenBucketLimiter(1, 2));

app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`Server listening on localhost:${PORT}`);
});
