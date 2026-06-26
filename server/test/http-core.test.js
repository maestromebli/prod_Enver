import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiOk, apiError, sendOk, sendError, AppError } from "../src/http/api-response.js";
import { apiFormatMiddleware } from "../src/http/api-format-middleware.js";
import { parseJson, parseJsonObject } from "../src/json-utils.js";
import { hashPassword, verifyPassword } from "../src/auth-utils.js";
import { buildOperatorDeepLink } from "../src/qr-link.js";
import { cleanupMemoryBuckets, incrementRateLimit } from "../src/middleware/rate-limit-store.js";
import { rateLimitLogin } from "../src/middleware/rate-limit.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

function runMiddleware(mw, req = {}) {
  return new Promise((resolve, reject) => {
    const res = mockRes();
    mw(req, res, (err) => (err ? reject(err) : resolve(res)));
  });
}

describe("http api-response", () => {
  it("apiOk / apiError", () => {
    assert.deepEqual(apiOk({ x: 1 }), { ok: true, data: { x: 1 } });
    assert.deepEqual(apiError("CODE", "msg"), {
      ok: false,
      error: { code: "CODE", message: "msg" }
    });
  });

  it("sendOk / sendError", () => {
    const res = mockRes();
    sendOk(res, { id: 1 }, 201);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { ok: true, data: { id: 1 } });

    sendError(res, 400, "VALIDATION_ERROR", "bad");
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  });

  it("AppError зберігає status і code", () => {
    const err = new AppError(403, "FORBIDDEN", "немає доступу");
    assert.equal(err.status, 403);
    assert.equal(err.code, "FORBIDDEN");
    assert.equal(err.expose, true);
  });
});

describe("apiFormatMiddleware", () => {
  it("обгортає plain object у apiOk", () => {
    const req = {};
    const res = mockRes();
    const originalJson = res.json.bind(res);
    res.json = originalJson;
    apiFormatMiddleware(req, res, () => {});
    res.json({ items: [1] });
    assert.deepEqual(res.body, { ok: true, data: { items: [1] } });
  });

  it("нормалізує legacy error", () => {
    const req = {};
    const res = mockRes();
    res.json = res.json.bind(res);
    apiFormatMiddleware(req, res, () => {});
    res.json({ error: "Старий формат" });
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.message, "Старий формат");
  });

  it("не чіпає вже v2", () => {
    const req = {};
    const res = mockRes();
    res.json = res.json.bind(res);
    apiFormatMiddleware(req, res, () => {});
    const payload = { ok: false, error: { code: "X", message: "y" } };
    res.json(payload);
    assert.deepEqual(res.body, payload);
  });
});

describe("json-utils", () => {
  it("parseJson з fallback", () => {
    assert.deepEqual(parseJson('{"a":1}', {}), { a: 1 });
    assert.deepEqual(parseJson("not-json", { x: 0 }), { x: 0 });
    assert.deepEqual(parseJsonObject(""), {});
  });
});

describe("auth-utils", () => {
  it("hash і verify пароля", () => {
    const stored = hashPassword("secret-pass");
    assert.ok(stored.includes(":"));
    assert.equal(verifyPassword("secret-pass", stored), true);
    assert.equal(verifyPassword("wrong", stored), false);
    assert.equal(verifyPassword("x", "bad-format"), false);
  });
});

describe("qr-link", () => {
  it("deep link містить position і stage", () => {
    const url = buildOperatorDeepLink({ positionId: 42, stageKey: "cutting" });
    assert.match(url, /position=42/);
    assert.match(url, /stage=cutting/);
  });

  it("deep link з req", () => {
    const url = buildOperatorDeepLink({
      positionId: 7,
      req: { protocol: "https", get: () => "app.local" }
    });
    assert.equal(url, "https://app.local/operator.html?position=7&stage=cutting");
  });
});

describe("rate-limit-store", () => {
  it("memory increment і cleanup", async () => {
    const key = `test-${Date.now()}`;
    const c1 = await incrementRateLimit(key, 60_000);
    const c2 = await incrementRateLimit(key, 60_000);
    assert.equal(c1, 1);
    assert.equal(c2, 2);
    cleanupMemoryBuckets(60_000);
  });
});

describe("rateLimitLogin", () => {
  it("пропускає localhost у development", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const res = await runMiddleware(rateLimitLogin(1, 60_000), {
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" }
      });
      assert.equal(res.statusCode, 200);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
