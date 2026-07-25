local key = KEYS[1]  --The Redis key representing the user’s request count.
local maxTokens = tonumber(ARGV[1]) --The rate limit (maximum number tokens in a bucket).
local refillRatePerSec = tonumber(ARGV[2]) --The time window (in seconds) for the rate limit.
local now = tonumber(ARGV[3])

--[[
If the user has reached the rate limit, return 0 (request blocked).

If the user is within the limit, increment their request count or set a new count with an expiration if it's the first request.

Return 1 (request allowed).
]]
-- if current and tonumber(current) >= limit then
--     return 0
-- else
--     if current then
--         redis.call("incr", key)
--     else
--         redis.call("set", key, 1, "EX", window)
--     end
--     return 1
-- end
-- Fetch current bucket state from a Redis Hash
local tokensInfo = redis.call("HMGET", key, "tokens", "lastRefill")
local tokens = tonumber(tokensInfo[1])
local lastRefill = tonumber(tokensInfo[2])

-- Initialize bucket if it doesn't exist
if not tokens then
    tokens = maxTokens
    lastRefill = now
else
    -- Lazy refill logic (same as your in-memory implementation)
    local elapsedSec = (now - lastRefill) / 1000
    local newTokens = elapsedSec * refillRatePerSec
    tokens = math.min(tokens + newTokens, maxTokens)
end

local allowed = 0
local retryAfter = 0

if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
else
    -- Calculate time needed to generate 1 full token
    local tokensNeeded = 1 - tokens
    retryAfter = math.ceil(tokensNeeded / refillRatePerSec)
end

-- Calculate TTL to automatically clean up keys that are fully refilled and inactive
local timeToRefillFull = math.ceil((maxTokens - tokens) / refillRatePerSec)
local ttl = math.max(timeToRefillFull, 1)

-- Save the updated state
redis.call("HSET", key, "tokens", tostring(tokens), "lastRefill", tostring(now))
redis.call("EXPIRE", key, ttl)

-- Return an array to Node.js
return { allowed, tostring(tokens), tostring(retryAfter) }