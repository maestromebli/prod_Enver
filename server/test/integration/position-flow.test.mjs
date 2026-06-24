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

describeIntegration("integration: order + position flow", () => {
  let server;
  let baseUrl;
  let token;
  const orderNumber = `TEST-${Date.now()}`;

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

  it("створює замовлення з root-позицією і підпозицію", async () => {
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        orderNumber,
        object: "Тестовий об'єкт",
        client: "CI",
        manager: "Admin",
        status: "Передано"
      })
    });
    assert.equal(orderRes.status, 201);
    const orderBody = await orderRes.json();
    const orderId = orderBody.data.id;
    assert.ok(orderId);

    const listRes = await fetch(`${baseUrl}/api/positions`, { headers: authHeaders(token) });
    const list = await listRes.json();
    const root = list.data.find((p) => p.orderNumber === orderNumber && !p.parentId);
    assert.ok(root, "root position created with order");

    const subRes = await fetch(`${baseUrl}/api/positions`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        parentId: root.id,
        orderId,
        orderNumber,
        object: "Тестовий об'єкт",
        item: "Шафа тест",
        manager: "Admin"
      })
    });
    assert.equal(subRes.status, 201);
    const subBody = await subRes.json();
    assert.equal(subBody.data.item, "Шафа тест");
    assert.equal(subBody.data.parentId, root.id);
  });
});
