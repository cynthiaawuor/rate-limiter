import { createClient } from "redis";

export type RedisClient = ReturnType<typeof createClient>;

const redisClient: RedisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`,
});

redisClient.connect().catch(console.error);

export { redisClient };
