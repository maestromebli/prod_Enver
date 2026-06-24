import crypto from "node:crypto";
import { createLogger } from "../logger.js";

const log = createLogger("http");

/** Додає X-Request-Id і структурований JSON-лог запиту. */
export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim().slice(0, 64)
      : crypto.randomBytes(8).toString("hex");

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const payload = {
      requestId,
      method: req.method,
      path: req.originalUrl?.split("?")[0] || req.path,
      status: res.statusCode,
      ms
    };
    if (res.statusCode >= 500) log.error("request", payload);
    else if (res.statusCode >= 400) log.warn("request", payload);
    else if (process.env.HTTP_LOG === "1") log.info("request", payload);
  });

  next();
}
