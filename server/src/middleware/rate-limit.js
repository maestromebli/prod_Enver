const buckets = new Map();

/** Простий rate limit по IP для login. */
export function rateLimitLogin(maxAttempts = 12, windowMs = 60_000) {
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxAttempts) {
      res.status(429).json({ error: "Забагато спроб входу. Спробуйте через хвилину." });
      return;
    }
    next();
  };
}
