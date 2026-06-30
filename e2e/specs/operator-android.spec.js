/* eslint-disable no-undef -- Playwright addInitScript/evaluate виконується в браузері */
import { expect, test } from "@playwright/test";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EnverOperator/1.0.8";

test.describe("Android APK / WebView", () => {
  test("operator.html — EnverNative вмикає native shell", async ({ page }) => {
    await page.addInitScript(() => {
      window.EnverNative = { pickFolder: () => {} };
    });
    await page.goto("/operator.html");
    await expect(page.locator("body.enver-native-shell")).toBeVisible();
  });

  test("viewer.html — EnverOperator UA вмикає tablet mode і native shell", async ({ browser }) => {
    const context = await browser.newContext({ userAgent: ANDROID_UA });
    const page = await context.newPage();
    await page.goto("/viewer.html");
    await expect(page.locator("html.viewer-tablet-mode")).toBeVisible();
    await expect(page.locator("html.enver-native-shell")).toBeVisible();
    await context.close();
  });

  test("viewer.html — sessionStorage scan payload для навігації з operator", async ({
    browser
  }) => {
    const context = await browser.newContext({ userAgent: ANDROID_UA });
    const page = await context.newPage();
    await page.goto("/operator.html");
    await page.evaluate(() => {
      localStorage.setItem("enver_token", "e2e-android-viewer-token");
      sessionStorage.setItem("enver_viewer_return", "/operator.html");
      sessionStorage.setItem(
        "enver_viewer_scan",
        JSON.stringify({
          partId: 1,
          payload: {
            part: { id: 1, partNo: "10", partCode: "0010X002X1", partName: "Тест" },
            cadGeometry: { holes: [{ diameterMm: 5, face: "panel", xMm: 10, yMm: 20 }] },
            model: {
              viewerUrl: "/api/test.glb",
              parts: [{ partNo: "10", partCode: "0010X002X1" }]
            },
            order: { orderNumber: "T-1" },
            position: { item: "Поз. 1" }
          }
        })
      );
    });
    await page.goto("/viewer.html?partId=1");
    await expect(page.locator("html.viewer-tablet-mode")).toBeVisible();
    const cacheConsumed = await page.evaluate(() => !sessionStorage.getItem("enver_viewer_scan"));
    expect(cacheConsumed).toBe(true);
    await context.close();
  });
});
