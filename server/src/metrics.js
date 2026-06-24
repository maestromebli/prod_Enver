/** Лічильники для /api/metrics (простий JSON, без Prometheus). */

const counters = {
  httpRequests: 0,
  httpErrors: 0,
  startedAt: new Date().toISOString()
};

export function recordHttpRequest(status) {
  counters.httpRequests += 1;
  if (status >= 500) counters.httpErrors += 1;
}

export function metricsSnapshot() {
  return {
    ...counters,
    uptimeSec: Math.round((Date.now() - new Date(counters.startedAt).getTime()) / 1000)
  };
}

export function metricsMiddleware(req, res, next) {
  res.on("finish", () => recordHttpRequest(res.statusCode));
  next();
}
