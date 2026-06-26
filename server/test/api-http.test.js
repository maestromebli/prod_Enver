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

describe("API HTTP", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApiApp({ dbConfigured: false, dbConnected: false });
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server?.close();
  });

  it("GET /api/health повертає ok і статус БД", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.database.configured, false);
    assert.equal(body.data.database.connected, false);
  });

  it("відповідь містить security headers від helmet", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.ok(res.headers.get("x-content-type-options"));
  });

  it("POST /api/auth/login без пароля — 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "admin" })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });

  it("POST /api/auth/login з порожнім тілом — 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
  });

  it("GET /api/positions без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/positions`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("GET /api/orders без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/orders`);
    assert.equal(res.status, 401);
  });

  it("GET /api/ai/analyses/1 без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/ai/analyses/1`);
    assert.equal(res.status, 401);
  });

  it("GET /api/metrics без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/metrics`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("GET /api/directories без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/directories`);
    assert.equal(res.status, 401);
  });

  it("GET /api/kpis без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/kpis`);
    assert.equal(res.status, 401);
  });

  it("GET /api/history без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/history`);
    assert.equal(res.status, 401);
  });

  it("GET /api/settings/ai без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/settings/ai`);
    assert.equal(res.status, 401);
  });

  it("GET /api/production/floor без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/production/floor`);
    assert.equal(res.status, 401);
  });

  it("GET /api/users без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    assert.equal(res.status, 401);
  });

  it("DELETE constructive package file без токена — 401 JSON (маршрут зареєстровано)", async () => {
    const res = await fetch(`${baseUrl}/api/positions/1/constructive-packages/1/files/1`, {
      method: "DELETE"
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "UNAUTHORIZED");
  });
});
