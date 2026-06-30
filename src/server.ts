import express from "express";
import { fixedWindowCounter } from "./middleware/fixedWindowCounter.js";

const app = express();
app.use(express.json());
const PORT = 5000;

const limiter = fixedWindowCounter(10 * 1000, 3);

app.use(limiter);

app.get("/", (req, res) => {
  res.send("welcome");
});

app.listen(PORT, (err) => {
  if (err) {
    console.log(err);
  }
  console.log(`Server listening on localhost:${PORT}`);
});
