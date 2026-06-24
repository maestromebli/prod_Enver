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

describe("godmode API HTTP", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApiApp({ dbConfigured: false, dbConnected: false });
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server?.close();
  });

  it("GET /api/notifications без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/notifications`);
    assert.equal(res.status, 401);
  });

  it("GET /api/notifications/stream без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/notifications/stream`);
    assert.equal(res.status, 401);
  });

  it("POST /api/positions/1/run-next-action без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/positions/1/run-next-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType: "handoff_to_edging" })
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/orders/1/run-next-action без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/orders/1/run-next-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionType: "close_order" })
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/operator/report-problem без токена — 401", async () => {
    const res = await fetch(`${baseUrl}/api/operator/report-problem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: 1, positionId: 1, comment: "test" })
    });
    assert.equal(res.status, 401);
  });
});
