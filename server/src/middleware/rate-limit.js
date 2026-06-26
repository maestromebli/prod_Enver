import { cleanupMemoryBuckets, incrementRateLimit } from "./rate-limit-store.js";

/** Rate limit по IP для login (memory або Redis через REDIS_URL). */
export function rateLimitLogin(maxAttempts = 12, windowMs = 60_000) {
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (
      process.env.NODE_ENV === "development" &&
      (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
    ) {
      next();
      return;
    }
    cleanupMemoryBuckets(windowMs);
    const key = `login:${ip}`;
    try {
      const count = await incrementRateLimit(key, windowMs);
      if (count > maxAttempts) {
        res.status(429).json({
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: "Забагато спроб входу. Спробуйте через хвилину."
          }
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
