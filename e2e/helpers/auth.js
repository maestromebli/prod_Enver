import { expect } from "@playwright/test";

const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || "admin";

/** Вхід адміністратора на головному додатку. */
export async function loginManager(page) {
  await page.goto("/");
  const modal = page.locator("#loginModal");
  if (await modal.isVisible()) {
    await page.locator("#loginInput").fill("admin");
    await page.locator("#loginPassword").fill(adminPassword);
    await page.locator("#loginForm button[type='submit']").click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.locator("#appRoot")).toBeVisible();
}

/** Вхід на operator.html (якщо потрібен логін). */
export async function loginOperator(page) {
  await page.goto("/operator.html");
  const modal = page.locator("#loginModal");
  if (await modal.isVisible()) {
    await page.locator("#loginInput").fill("admin");
    await page.locator("#loginPassword").fill(adminPassword);
    await page.locator("#loginForm button[type='submit']").click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.locator("body.enver-operator-ui")).toBeVisible();
}
