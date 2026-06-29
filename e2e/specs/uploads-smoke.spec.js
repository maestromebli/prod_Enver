import { expect, test } from "@playwright/test";
import { authHeaders, createOrderWithPackage, loginAdmin } from "../helpers/api.js";

const MINIMAL_PDF_B64 = Buffer.from("%PDF-1.0\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString(
  "base64"
);

test.describe("E2E: завантаження файлів по системі", () => {
  const orderNumber = `E2E-UP-${Date.now()}`;
  let adminToken;
  let orderId;
  let positionId;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAdmin(request));
    const created = await createOrderWithPackage(request, adminToken, orderNumber);
    orderId = created.orderId;
    positionId = created.positionId;
  });

  test.afterAll(async ({ request }) => {
    if (orderId) {
      await request.delete(`/api/orders/${orderId}`, { headers: authHeaders(adminToken) });
    }
  });

  test("health — uploadsWritable на сервері", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const data = body.data ?? body;
    expect(data.uploads?.ok ?? true).toBe(true);
  });

  test("менеджер: POST /positions/:id/files", async ({ request }) => {
    const res = await request.post(`/api/positions/${positionId}/files`, {
      headers: authHeaders(adminToken),
      data: {
        fileName: "e2e-manager.pdf",
        mime: "application/pdf",
        kind: "manager_other",
        dataBase64: MINIMAL_PDF_B64
      }
    });
    expect(res.status()).toBe(201);
  });

  test("legacy: POST /positions/:id/constructive-file", async ({ request }) => {
    const res = await request.post(`/api/positions/${positionId}/constructive-file`, {
      headers: authHeaders(adminToken),
      data: {
        fileName: "e2e-legacy.pdf",
        mime: "application/pdf",
        dataBase64: MINIMAL_PDF_B64
      }
    });
    expect(res.status()).toBe(201);
  });

  test("стіл конструктора: POST /constructor-desk/positions/:id/files", async ({ request }) => {
    const res = await request.post(`/api/constructor-desk/positions/${positionId}/files`, {
      headers: authHeaders(adminToken),
      data: {
        fileName: "e2e-desk.pdf",
        mime: "application/pdf",
        kind: "custom",
        label: "E2E",
        dataBase64: MINIMAL_PDF_B64
      }
    });
    expect(res.status()).toBe(201);
  });

  test("3D замовлення: POST /orders/:id/3d/upload", async ({ request }) => {
    const glb = Buffer.from(
      "glTF\x02\x00\x00\x00\x0c\x00\x00\x00JSON\x02\x00\x00\x00{}\x00\x00",
      "binary"
    ).toString("base64");
    const res = await request.post(`/api/orders/${orderId}/3d/upload`, {
      headers: authHeaders(adminToken),
      data: {
        fileName: "e2e-mini.glb",
        mime: "model/gltf-binary",
        dataBase64: glb
      }
    });
    expect(res.status()).toBe(201);
  });
});
