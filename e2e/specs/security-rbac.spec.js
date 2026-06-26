import { expect, test } from "@playwright/test";
import {
  apiLogin,
  authHeaders,
  createOperatorUser,
  createOrderWithPackage,
  deleteUser,
  loginAdmin
} from "../helpers/api.js";

test.describe("E2E: RBAC і файли оператора", () => {
  const orderNumber = `E2E-RBAC-${Date.now()}`;
  const operatorLogin = `e2e-op-${Date.now()}`;
  let adminToken;
  let operatorToken;
  let operatorUserId;
  let orderId;
  let positionId;
  let packageId;
  let fileId;
  let otherOrderId;
  let otherPositionId;

  test.beforeAll(async ({ request }) => {
    ({ token: adminToken } = await loginAdmin(request));
    const op = await createOperatorUser(request, adminToken, operatorLogin);
    operatorUserId = op.id;
    ({ token: operatorToken } = await apiLogin(request, operatorLogin, "e2e-op-pass"));
    const created = await createOrderWithPackage(request, adminToken, orderNumber);
    orderId = created.orderId;
    positionId = created.positionId;
    packageId = created.packageId;
    fileId = created.fileId;
    const other = await createOrderWithPackage(request, adminToken, `${orderNumber}-B`);
    otherOrderId = other.orderId;
    otherPositionId = other.positionId;
  });

  test.afterAll(async ({ request }) => {
    await deleteUser(request, adminToken, operatorUserId);
    if (otherOrderId) {
      await request.delete(`/api/orders/${otherOrderId}`, { headers: authHeaders(adminToken) });
    }
    if (orderId) {
      await request.delete(`/api/orders/${orderId}`, { headers: authHeaders(adminToken) });
    }
  });

  test("оператор не бачить списки замовлень і позицій", async ({ request }) => {
    const orders = await request.get("/api/orders", { headers: authHeaders(operatorToken) });
    expect(orders.status()).toBe(403);
    const positions = await request.get("/api/positions", {
      headers: authHeaders(operatorToken)
    });
    expect(positions.status()).toBe(403);
  });

  test("оператор бачить чергу цеху", async ({ request }) => {
    const res = await request.get("/api/operator/queue/cutting", {
      headers: authHeaders(operatorToken)
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const payload = body.data ?? body;
    expect(Array.isArray(payload.queue)).toBe(true);
  });

  test("PDF пакета доступний через access_token без Bearer", async ({ request }) => {
    expect(packageId && fileId && positionId).toBeTruthy();
    const url = `/api/positions/${positionId}/constructive-packages/${packageId}/files/${fileId}?access_token=${encodeURIComponent(adminToken)}`;
    const res = await request.get(url);
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"] || "";
    expect(ct).toMatch(/pdf|octet-stream/i);
  });

  test("IDOR: чужий position_id у URL файлу — 404", async ({ request }) => {
    expect(otherPositionId).toBeTruthy();
    const res = await request.get(
      `/api/positions/${otherPositionId}/constructive-packages/${packageId}/files/${fileId}`,
      { headers: authHeaders(adminToken) }
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("E2E: operator UI", () => {
  test("operator.html — вхід admin і панель цеху", async ({ page }) => {
    const password = process.env.ADMIN_DEFAULT_PASSWORD || "admin";
    await page.goto("/operator.html");
    const modal = page.locator("#loginModal");
    if (await modal.isVisible()) {
      await page.locator("#loginInput").fill("admin");
      await page.locator("#loginPassword").fill(password);
      await page.locator("#loginForm button[type='submit']").click();
      await expect(modal).toBeHidden({ timeout: 15_000 });
    }
    await expect(page.locator("body.enver-operator-ui")).toBeVisible();
    await expect(page.locator("#content, #appRoot").first()).toBeVisible();
  });
});
