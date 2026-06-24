import { cleanupMemoryBuckets, incrementRateLimit } from "./rate-limit-store.js";

/** Rate limit по IP для login (memory або Redis через REDIS_URL). */
export function rateLimitLogin(maxAttempts = 12, windowMs = 60_000) {
  return async (req, res, next) => {
    cleanupMemoryBuckets(windowMs);
    const key = `login:${req.ip || req.socket?.remoteAddress || "unknown"}`;
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
