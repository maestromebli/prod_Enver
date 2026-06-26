import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  authHeaders,
  cleanupTestOrder,
  createTestOrder,
  createTestUser,
  deleteTestUser,
  integrationEnabled,
  listen,
  loginAs,
  runMigrations
} from "./helpers.mjs";

const describeIntegration = integrationEnabled() ? describe : describe.skip;

const MINIMAL_PDF_B64 = Buffer.from("%PDF-1.0\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString(
  "base64"
);

describeIntegration("integration: RBAC audit regressions", () => {
  let server;
  let baseUrl;
  let adminToken;
  let operatorToken;
  let operatorUserId;
  const orderNumberA = `RBAC-A-${Date.now()}`;
  const orderNumberB = `RBAC-B-${Date.now()}`;
  const operatorLogin = `op-rbac-${Date.now()}`;
  let positionAId;
  let packageId;
  let fileId;

  before(async () => {
    runMigrations();
    const { createApiApp } = await import("../../src/app.js");
    const app = createApiApp({ dbConfigured: true, dbConnected: true });
    ({ server, baseUrl } = await listen(app));

    const password = process.env.ADMIN_DEFAULT_PASSWORD || "admin";
    ({ token: adminToken } = await loginAs(baseUrl, "admin", password));

    const opUser = await createTestUser(baseUrl, adminToken, {
      login: operatorLogin,
      password: "op-rbac-pass",
      role: "operator",
      stages: ["cutting"]
    });
    operatorUserId = opUser.id;
    ({ token: operatorToken } = await loginAs(baseUrl, operatorLogin, "op-rbac-pass"));

    const orderA = await createTestOrder(baseUrl, adminToken, orderNumberA);
    const orderB = await createTestOrder(baseUrl, adminToken, orderNumberB);

    const listRes = await fetch(`${baseUrl}/api/positions`, { headers: authHeaders(adminToken) });
    const positions = (await listRes.json()).data;
    positionAId = positions.find((p) => p.orderNumber === orderNumberA && !p.parentId)?.id;
    const positionBId = positions.find((p) => p.orderNumber === orderNumberB && !p.parentId)?.id;
    assert.ok(positionAId, "position A");
    assert.ok(positionBId, "position B");

    const uploadRes = await fetch(`${baseUrl}/api/positions/${positionAId}/constructive-packages`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        fileName: "spec.pdf",
        dataBase64: MINIMAL_PDF_B64,
        mime: "application/pdf",
        kind: "assembly_pdf"
      })
    });
    const uploadText = await uploadRes.text();
    assert.equal(uploadRes.status, 201, uploadText);
    const pkgBody = JSON.parse(uploadText);
    const detail = pkgBody.data ?? pkgBody;
    packageId = detail.package?.id ?? detail.id;
    fileId = detail.files?.[0]?.id;
    assert.ok(packageId, "package id");
    assert.ok(fileId, "file id");
  });

  after(async () => {
    await deleteTestUser(baseUrl, adminToken, operatorUserId);
    await cleanupTestOrder(orderNumberA);
    await cleanupTestOrder(orderNumberB);
    server?.close();
  });

  it("оператор — 403 на списки замовлень і позицій", async () => {
    const orders = await fetch(`${baseUrl}/api/orders`, { headers: authHeaders(operatorToken) });
    assert.equal(orders.status, 403);

    const positions = await fetch(`${baseUrl}/api/positions`, {
      headers: authHeaders(operatorToken)
    });
    assert.equal(positions.status, 403);
  });

  it("оператор — 403 на manager-data позиції", async () => {
    assert.ok(positionAId);
    const res = await fetch(`${baseUrl}/api/positions/${positionAId}/manager-data`, {
      headers: authHeaders(operatorToken)
    });
    assert.equal(res.status, 403);
  });

  it("оператор — черга цеху доступна", async () => {
    const res = await fetch(`${baseUrl}/api/operator/queue/cutting`, {
      headers: authHeaders(operatorToken)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const payload = body.data ?? body;
    assert.ok(Array.isArray(payload.queue));
  });

  it("оператор — 403 на POST /api/ai/assist", async () => {
    const res = await fetch(`${baseUrl}/api/ai/assist`, {
      method: "POST",
      headers: authHeaders(operatorToken),
      body: JSON.stringify({ mode: "hints", context: {} })
    });
    assert.equal(res.status, 403);
  });

  it("admin — списки замовлень доступні", async () => {
    const res = await fetch(`${baseUrl}/api/orders`, { headers: authHeaders(adminToken) });
    assert.equal(res.status, 200);
  });

  it("IDOR: файл пакета з чужим position_id у URL — 404", async () => {
    assert.ok(packageId && fileId && positionAId);

    const listRes = await fetch(`${baseUrl}/api/positions`, { headers: authHeaders(adminToken) });
    const positions = (await listRes.json()).data;
    const positionBId = positions.find((p) => p.orderNumber === orderNumberB && !p.parentId)?.id;
    assert.ok(positionBId);

    const wrongUrl = `${baseUrl}/api/positions/${positionBId}/constructive-packages/${packageId}/files/${fileId}`;
    const res = await fetch(wrongUrl, { headers: authHeaders(adminToken) });
    assert.equal(res.status, 404);
  });

  it("legacy package URL редіректить на position-scoped шлях", async () => {
    assert.ok(packageId && fileId && positionAId);

    const legacyUrl = `${baseUrl}/api/constructive/packages/${packageId}/files/${fileId}`;
    const res = await fetch(legacyUrl, {
      headers: authHeaders(adminToken),
      redirect: "manual"
    });
    assert.equal(res.status, 307);
    const location = res.headers.get("location") || "";
    assert.match(
      location,
      new RegExp(`/api/positions/${positionAId}/constructive-packages/${packageId}/files/${fileId}`)
    );
  });
});
