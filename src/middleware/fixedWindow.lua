-- fixedWindow.lua
-- KEYS[1]  = rate limit key, e.g. "rate_limit:<id>"
-- ARGV[1]  = window_size (in seconds)
-- ARGV[2]  = limit (max requests per window)
-- ARGV[3]  = now (ms) -- not needed for TTL-based logic, kept for parity with caller

local key = KEYS[1]
local window_size = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current = redis.call("GET", key)

-- No entry yet: start a fresh window
if current == false then
  redis.call("SET", key, 1, "EX", window_size)
  return { 1, limit - 1, window_size }
end

current = tonumber(current)

if current < limit then
  local new_val = redis.call("INCR", key)
  local ttl = redis.call("TTL", key)
  -- Safety net: if TTL somehow got lost (e.g. persisted key), re-apply it
  if ttl == -1 then
    redis.call("EXPIRE", key, window_size)
    ttl = window_size
  end
  return { 1, limit - new_val, ttl }
else
  local ttl = redis.call("TTL", key)
  if ttl == -1 then
    redis.call("EXPIRE", key, window_size)
    ttl = window_size
  end
  return { 0, 0, ttl }
end