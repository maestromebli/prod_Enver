import { expect, test } from "@playwright/test";
import { loginManager, loginOperator } from "../helpers/auth.js";
import { auditRegion, MANAGER_TABS, setTheme } from "../helpers/visual-audit.js";

function formatContrastIssues(issues) {
  return issues
    .map(
      (i) =>
        `  • ${i.selector} «${i.text}» — контраст ${i.ratio}:1 (мін. ${i.minRequired}:1), ${i.color} на ${i.background}`
    )
    .join("\n");
}

function formatTableIssues(issues) {
  return issues
    .map((i) => {
      if (i.type === "column-count") {
        return `  • ${i.table}: заголовок ${i.headerCols} кол., рядок ${i.bodyCols} кол.`;
      }
      if (i.type === "column-misalign") {
        return `  • ${i.table} кол. «${i.header}»: зсув ${i.deltaLeft}px, ширина Δ${i.deltaWidth}px`;
      }
      if (i.type === "horizontal-overflow") {
        return `  • ${i.table}: горизонтальний переповнення ${i.scrollWidth}px > ${i.clientWidth}px`;
      }
      return `  • ${JSON.stringify(i)}`;
    })
    .join("\n");
}

test.describe("Візуальний аудит ENVER", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
  });

  for (const theme of ["light", "dark"]) {
    test(`менеджер: контраст і таблиці (${theme})`, async ({ page }) => {
      await loginManager(page);
      await setTheme(page, theme);
      await page.reload();
      await expect(page.locator("#appRoot")).toBeVisible();

      const allContrast = [];
      const allTables = [];

      for (const tab of MANAGER_TABS) {
        const tabBtn = page.locator(`#tabs .tab-btn[data-tab="${tab}"]`);
        if ((await tabBtn.count()) === 0) continue;
        await tabBtn.click();
        await expect(page.locator("#pageTitle")).toContainText(tab, { timeout: 10_000 });
        await page
          .locator("#loadingOverlay[aria-busy='false'], #loadingOverlay:not([aria-busy='true'])")
          .first()
          .waitFor({
            state: "attached",
            timeout: 15_000
          })
          .catch(() => {});

        const { contrastIssues, tableIssues } = await auditRegion(page, "#content");
        for (const issue of contrastIssues) {
          allContrast.push({ tab, ...issue });
        }
        for (const issue of tableIssues) {
          allTables.push({ tab, ...issue });
        }
      }

      expect(
        allContrast,
        `Проблеми контрасту (${theme}):\n${formatContrastIssues(allContrast)}`
      ).toEqual([]);

      expect(allTables, `Проблеми таблиць (${theme}):\n${formatTableIssues(allTables)}`).toEqual(
        []
      );
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`оператор: контраст (${theme})`, async ({ page }) => {
      await loginOperator(page);
      await setTheme(page, theme);
      await page.reload();
      await expect(page.locator("body.enver-operator-ui")).toBeVisible();

      const { contrastIssues, tableIssues } = await auditRegion(page, "#content, #appRoot, body");

      expect(
        contrastIssues,
        `Проблеми контрасту оператора (${theme}):\n${formatContrastIssues(contrastIssues)}`
      ).toEqual([]);

      expect(
        tableIssues,
        `Проблеми таблиць оператора (${theme}):\n${formatTableIssues(tableIssues)}`
      ).toEqual([]);
    });
  }

  test("логін: читабельність у світлій та темній темі", async ({ page }) => {
    for (const theme of ["light", "dark"]) {
      await page.goto("/");
      await setTheme(page, theme);
      await page.reload();
      await expect(page.locator("#loginModal")).toBeVisible();

      const { contrastIssues } = await auditRegion(page, ".login-form-body, .login-form-footer");
      expect(contrastIssues, `Логін (${theme}):\n${formatContrastIssues(contrastIssues)}`).toEqual(
        []
      );
    }
  });
});
