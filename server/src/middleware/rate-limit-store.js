/**
 * Сховище для rate limit: in-memory або Redis (REDIS_URL).
 */

const buckets = new Map();
let redisClient = null;
let redisInitFailed = false;

async function getRedis() {
  if (redisInitFailed || !process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;
  try {
    const { createClient } = await import("redis");
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", () => {});
    await redisClient.connect();
    return redisClient;
  } catch {
    redisInitFailed = true;
    return null;
  }
}

function memoryIncrement(key, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count;
}

export async function incrementRateLimit(key, windowMs) {
  const redis = await getRedis();
  if (redis) {
    const redisKey = `enver:rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.pExpire(redisKey, windowMs);
    return count;
  }
  return memoryIncrement(key, windowMs);
}

export function cleanupMemoryBuckets(windowMs) {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > windowMs) buckets.delete(key);
  }
}
