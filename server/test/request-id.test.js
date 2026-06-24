import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { createApiApp } from "../src/app.js";

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

describe("request-id middleware", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApiApp({ dbConfigured: false, dbConnected: false });
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server?.close();
  });

  it("генерує X-Request-Id якщо не передано", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const id = res.headers.get("x-request-id");
    assert.ok(id);
    assert.match(id, /^[a-f0-9]+$/);
  });

  it("пробрасовує вхідний X-Request-Id", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { "X-Request-Id": "test-req-abc" }
    });
    assert.equal(res.headers.get("x-request-id"), "test-req-abc");
  });
});
