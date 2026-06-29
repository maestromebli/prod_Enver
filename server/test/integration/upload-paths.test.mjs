import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  authHeaders,
  cleanupTestOrder,
  createTestOrder,
  integrationEnabled,
  listen,
  loginAs,
  runMigrations
} from "./helpers.mjs";

const describeIntegration = integrationEnabled() ? describe : describe.skip;

const MINIMAL_PDF_B64 = Buffer.from("%PDF-1.0\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString(
  "base64"
);
const MINI_GLB_B64 = Buffer.from(
  "glTF\x02\x00\x00\x00\x0c\x00\x00\x00JSON\x02\x00\x00\x00{}\x00\x00",
  "binary"
).toString("base64");

describeIntegration("integration: усі шляхи завантаження файлів", () => {
  let server;
  let baseUrl;
  let token;
  const orderNumber = `TEST-UP-${Date.now()}`;
  let orderId;
  let positionId;

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

  it("health: uploadsWritable", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(body.data?.uploads?.ok, true, JSON.stringify(body.data?.uploads));
    assert.equal(body.data?.features?.uploadsWritable, true);
  });

  it("створює замовлення і позицію", async () => {
    const created = await createTestOrder(baseUrl, token, orderNumber);
    orderId = created.id;
    const listRes = await fetch(`${baseUrl}/api/positions`, { headers: authHeaders(token) });
    const positions = (await listRes.json()).data;
    positionId = positions.find((p) => p.orderNumber === orderNumber && !p.parentId)?.id;
    assert.ok(positionId);
  });

  it("POST /positions/:id/constructive-file — legacy PDF", async () => {
    const res = await fetch(`${baseUrl}/api/positions/${positionId}/constructive-file`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "legacy-spec.pdf",
        mime: "application/pdf",
        dataBase64: MINIMAL_PDF_B64
      })
    });
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  });

  it("POST /positions/:id/constructive-packages — пакет PDF", async () => {
    const res = await fetch(`${baseUrl}/api/positions/${positionId}/constructive-packages`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "package-spec.pdf",
        mime: "application/pdf",
        kind: "assembly_pdf",
        dataBase64: MINIMAL_PDF_B64
      })
    });
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  });

  it("POST /positions/:id/files — файл менеджера", async () => {
    const res = await fetch(`${baseUrl}/api/positions/${positionId}/files`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "manager-note.pdf",
        mime: "application/pdf",
        kind: "manager_other",
        dataBase64: MINIMAL_PDF_B64
      })
    });
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  });

  it("POST /constructor-desk/positions/:id/files — стіл конструктора", async () => {
    const res = await fetch(`${baseUrl}/api/constructor-desk/positions/${positionId}/files`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "desk-ref.pdf",
        mime: "application/pdf",
        kind: "custom",
        label: "Тест",
        dataBase64: MINIMAL_PDF_B64
      })
    });
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  });

  it("POST /orders/:id/3d/upload — GLB", async () => {
    const res = await fetch(`${baseUrl}/api/orders/${orderId}/3d/upload`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileName: "mini.glb",
        mime: "model/gltf-binary",
        dataBase64: MINI_GLB_B64
      })
    });
    assert.equal(res.status, 201, JSON.stringify(await res.json()));
  });
});
