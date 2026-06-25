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
  let orderId;
  let subId;

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
    orderId = orderBody.data.id;
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
    subId = subBody.data.id;
  });

  it("зберігає manager-data і повертає агрегацію замовлення", async () => {
    assert.ok(subId, "підпозиція з попереднього тесту");
    assert.ok(orderId, "замовлення з попереднього тесту");

    const putRes = await fetch(`${baseUrl}/api/positions/${subId}/manager-data`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        delivery: {
          address: "вул. Тестова 1",
          contactName: "CI",
          contactPhone: "+380000000000"
        },
        markComplete: false
      })
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.data.managerData.delivery.address, "вул. Тестова 1");

    const getRes = await fetch(`${baseUrl}/api/positions/${subId}/manager-data`, {
      headers: authHeaders(token)
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.data.managerData.delivery.contactName, "CI");

    const orderRes = await fetch(`${baseUrl}/api/orders/${orderId}`, {
      headers: authHeaders(token)
    });
    assert.equal(orderRes.status, 200);
    const orderBody = await orderRes.json();
    assert.ok(orderBody.data.summary, "summary у GET замовлення");
    assert.ok(
      Number.isFinite(orderBody.data.summary.workPositionCount),
      "workPositionCount у summary"
    );

    const posRes = await fetch(`${baseUrl}/api/positions/${subId}`, {
      headers: authHeaders(token)
    });
    assert.equal(posRes.status, 200);
    const posBody = await posRes.json();
    assert.ok(posBody.data.managerData, "managerData у GET позиції");
    assert.ok(Array.isArray(posBody.data.managerFiles), "managerFiles у GET позиції");
  });
});
