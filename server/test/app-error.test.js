import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { AppError, apiError } from "../src/http/api-response.js";
import { apiFormatMiddleware } from "../src/http/api-format-middleware.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { createLogger } from "../src/logger.js";

const log = createLogger("api");

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function createTestApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use("/api", apiFormatMiddleware);

  app.get("/api/test-app-error", () => {
    throw new AppError(403, "FORBIDDEN", "немає прав");
  });
  app.get("/api/test-boom", () => {
    throw new Error("secret internals");
  });

  app.use((err, req, res, _next) => {
    log.error("unhandled", { requestId: req.requestId, message: err?.message });
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const code = err?.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
    const message =
      status >= 500 && !err?.expose ? "Внутрішня помилка сервера" : err?.message || "Помилка";
    res.status(status).json(apiError(code, message));
  });

  return app;
}

describe("app error handler", () => {
  let server;
  let baseUrl;

  before(async () => {
    ({ server, baseUrl } = await listen(createTestApp()));
  });

  after(() => {
    server?.close();
  });

  it("AppError повертає expose message і status", async () => {
    const res = await fetch(`${baseUrl}/api/test-app-error`);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "FORBIDDEN");
    assert.equal(body.error.message, "немає прав");
  });

  it("невідома помилка — 500 без expose", async () => {
    const res = await fetch(`${baseUrl}/api/test-boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.message, "Внутрішня помилка сервера");
  });
});
