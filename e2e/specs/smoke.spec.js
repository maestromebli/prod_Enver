import { expect, test } from "@playwright/test";
import { loginManager } from "../helpers/auth.js";

test.describe("ENVER smoke", () => {
  test("login і стартова вкладка Огляд", async ({ page }) => {
    await loginManager(page);
    await expect(page.locator("#pageTitle")).toContainText("Огляд");
    await expect(page.locator("#tabs .tab-btn.active")).toContainText("Огляд");
  });

  test("налаштування → сповіщення без перекриття панелі", async ({ page }) => {
    await loginManager(page);
    const gear = page.locator("#settingsGearBtn");
    if (await gear.isVisible()) {
      await gear.click();
      await expect(page.locator("#pageTitle")).toContainText("Налаштування", { timeout: 10_000 });
      await page.locator('[data-settings-section="notifications"]').click();
      await expect(page.locator(".settings-section--notify")).toBeVisible();
      const panel = page.locator("#godmodeNotifyPanel:not([hidden])");
      await expect(panel).toHaveCount(0);
    }
  });
});

test.describe("operator entry", () => {
  test("operator.html завантажується", async ({ page }) => {
    await page.goto("/operator.html");
    await expect(page.locator("body.enver-operator-ui")).toBeVisible();
    await expect(page.locator("#loginModal, #appRoot").first()).toBeVisible();
  });
});
