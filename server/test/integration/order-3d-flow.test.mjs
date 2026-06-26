import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  authHeaders,
  cleanupTestOrder,
  integrationEnabled,
  listen,
  loginAs,
  runMigrations
} from "./helpers.mjs";

const describeIntegration = integrationEnabled() ? describe : describe.skip;

/** Мінімальний валідний GLB (header + empty chunks). */
const MINI_GLB = Buffer.from(
  "glTF\x02\x00\x00\x00\x0c\x00\x00\x00JSON\x02\x00\x00\x00{}\x00\x00",
  "binary"
);

describeIntegration("integration: order 3D + procurement", () => {
  let server;
  let baseUrl;
  let token;
  const orderNumber = `TEST-3D-${Date.now()}`;
  let orderId;
  let assetId;

  before(async () => {
    runMigrations();
    const { createApiApp } = await import("../../src/app.js");
    const app = createApiApp({ dbConfigured: true, dbConnected: true });
    ({ server, baseUrl } = await listen(app));
    const password = process.env.ADMIN_DEFAULT_PASSWORD || "admin";
    ({ token } = await loginAs(baseUrl, "admin", password));
  });

  after(async () => {
    server?.close();
    await cleanupTestOrder(orderNumber);
  });

  it("створює замовлення для 3D", async () => {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        orderNumber,
        object: "3D тест",
        client: "CI",
        manager: "Admin",
        status: "Передано"
      })
    });
    assert.equal(res.status, 201);
    orderId = (await res.json()).data.id;
    assert.ok(orderId);
  });

  it("GET /api/orders/:id/3d — порожньо до завантаження", async () => {
    const res = await fetch(`${baseUrl}/api/orders/${orderId}/3d`, {
      headers: authHeaders(token)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data?.asset, null);
  });

  it("POST upload .glb — READY без конвертації", async () => {
    const res = await fetch(`${baseUrl}/api/orders/${orderId}/3d/upload`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "mini.glb",
        mime: "model/gltf-binary",
        dataBase64: MINI_GLB.toString("base64")
      })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data?.asset?.status, "READY");
    assert.ok(body.data?.asset?.webModelUrl);
    assetId = body.data.asset.id;
  });

  it("GET web-model stream", async () => {
    const res = await fetch(`${baseUrl}/api/orders/${orderId}/3d/${assetId}/web-model`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /gltf|octet/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0);
  });

  it("DELETE 3D asset", async () => {
    const res = await fetch(`${baseUrl}/api/orders/${orderId}/3d/${assetId}`, {
      method: "DELETE",
      headers: authHeaders(token)
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it("GET /api/procurement — реєстр закупівель", async () => {
    const res = await fetch(`${baseUrl}/api/procurement`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });
});
