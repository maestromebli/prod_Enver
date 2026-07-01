/* eslint-disable no-undef -- Playwright evaluate у браузері */
import { expect, test } from "@playwright/test";

test.describe("Operator scan panel", () => {
  test("ручний код не відкриває popup 3D автоматично", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("enver_token", "e2e-operator-scan-token");
    });

    let popupCount = 0;
    page.on("popup", () => {
      popupCount += 1;
    });

    await page.route("**/api/parts/scan", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          part: {
            id: 42,
            partNo: "10",
            partCode: "0010X002X1",
            partName: "Полиця тест",
            material: "ДСП",
            length: 600,
            width: 400,
            thickness: 18
          },
          order: { orderNumber: "E2E-1" },
          position: { id: 1, item: "Кухня" },
          model: {
            viewerUrl: "/api/positions/1/constructive-packages/1/files/9",
            viewerFormat: "glb",
            mappingStatus: "exact",
            mappingConfidence: 100,
            mappingHint: "3D звʼязано",
            resolvedMeshName: "panel-0010X002X1",
            resolvedNodeId: "0010X002X1",
            parts: []
          },
          cadGeometry: { holes: [] }
        })
      });
    });

    await page.route("**/api/operator/**", async (route) => {
      if (route.request().url().includes("/session")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { id: 1, login: "Cutting", role: "operator_cutting" } })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ queue: [], session: null })
      });
    });

    await page.goto("/operator.html");
    await page.waitForSelector("#operatorPartScan", { state: "attached" });

    await page.evaluate(() => {
      document.getElementById("operatorPartScan").hidden = false;
      document.getElementById("operatorScanInput").value = "0010x002x1V";
    });

    await page.locator("#operatorScanInput").press("Enter");
    await expect(page.locator("#operatorPartScanDetail")).toBeVisible({ timeout: 8000 });
    expect(popupCount).toBe(0);
  });
});
