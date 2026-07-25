import { redisClient } from "./redisClient.js";

export type AllowlistStore = "memory" | "redis";

export interface AllowlistConfig {
  store: AllowlistStore;
}

const REDIS_ALLOWLIST_KEY = "rate_limit:allowlist";

// Shared across every in-memory allowlist instance in this process, mirroring
// how the in-memory rate limit stores are process-wide. Mutating it takes
// effect on the very next request — no restart needed.
const memoryAllowlist = new Set<string>();

export async function addTrustedCaller(
  key: string,
  config: AllowlistConfig,
): Promise<void> {
  if (config.store === "redis") {
    await redisClient.sAdd(REDIS_ALLOWLIST_KEY, key);
  } else {
    memoryAllowlist.add(key);
  }
}

export async function removeTrustedCaller(
  key: string,
  config: AllowlistConfig,
): Promise<void> {
  if (config.store === "redis") {
    await redisClient.sRem(REDIS_ALLOWLIST_KEY, key);
  } else {
    memoryAllowlist.delete(key);
  }
}

export async function isTrustedCaller(
  key: string,
  config: AllowlistConfig,
): Promise<boolean> {
  if (config.store === "redis") {
    return (await redisClient.sIsMember(REDIS_ALLOWLIST_KEY, key)) === 1;
  }
  return memoryAllowlist.has(key);
}

export async function listTrustedCallers(
  config: AllowlistConfig,
): Promise<string[]> {
  if (config.store === "redis") {
    return redisClient.sMembers(REDIS_ALLOWLIST_KEY);
  }
  return Array.from(memoryAllowlist);
}
