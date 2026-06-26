/**
 * Аудит контрасту тексту та вирівнювання колонок таблиць (виконується в контексті сторінки).
 * Повертає масиви проблем для звіту в Playwright.
 */

export const MANAGER_TABS = [
  "Огляд",
  "Замовлення",
  "Потребує уваги",
  "Цех зараз",
  "Конструктори",
  "Встановлення",
  "Історія змін"
];

/** @param {import('@playwright/test').Page} page */
export async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("enver_theme", t);
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  }, theme);
}

/** @param {import('@playwright/test').Page} page */
export async function auditRegion(page, rootSelector = "#content") {
  return page.evaluate((selector) => {
    const MIN_CONTRAST = 3;
    const MIN_MUTED_CONTRAST = 2.5;
    const MAX_ISSUES = 40;

    function parseColor(input) {
      if (!input || input === "transparent") return null;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#000000";
      ctx.fillStyle = input;
      const normalized = ctx.fillStyle;
      if (normalized.startsWith("#")) {
        const hex = normalized.slice(1);
        const full =
          hex.length === 3
            ? hex
                .split("")
                .map((c) => c + c)
                .join("")
            : hex;
        const num = Number.parseInt(full, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 1];
      }
      const m = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
    }

    function luminance([r, g, b]) {
      const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrast(fg, bg) {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function blend(fg, bg) {
      const a = fg[3];
      return [
        Math.round(bg[0] * (1 - a) + fg[0] * a),
        Math.round(bg[1] * (1 - a) + fg[1] * a),
        Math.round(bg[2] * (1 - a) + fg[2] * a),
        1
      ];
    }

    function effectiveBackground(el) {
      let bg = null;
      let node = el;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const color = parseColor(style.backgroundColor);
        if (color && color[3] > 0.05) {
          bg = bg ? blend(color, bg) : color;
          if (color[3] >= 0.95) break;
        }
        node = node.parentElement;
      }
      if (!bg) {
        bg = parseColor(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
      }
      return bg;
    }

    function isMutedElement(el) {
      const cls = el.className?.toString?.() || "";
      if (/muted|soft|hint|subtitle|tagline|placeholder|secondary|label/i.test(cls)) return true;
      const style = getComputedStyle(el);
      const fs = Number.parseFloat(style.fontSize) || 14;
      const fw = Number.parseInt(style.fontWeight, 10) || 400;
      return fs <= 12 && fw < 700;
    }

    function isVisible(el) {
      if (!el || el.closest("[aria-hidden='true']")) return false;
      if (el.closest(".login-hero")) return false;
      if (el.matches(":disabled, [disabled]")) return false;
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) < 0.4
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function textNodes(el) {
      const chunks = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
            return NodeFilter.FILTER_REJECT;
          }
          const t = node.textContent?.replace(/\s+/g, " ").trim();
          if (!t || t.length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = walker.nextNode())) {
        const parent = n.parentElement;
        if (!chunks.some((c) => c.el === parent)) {
          chunks.push({ el: parent, text: n.textContent.trim().slice(0, 80) });
        }
      }
      return chunks;
    }

    function describeEl(el) {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls =
        el.className && typeof el.className === "string"
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
          : "";
      return `${tag}${id}${cls}`;
    }

    const root = document.querySelector(selector) || document.body;
    const contrastIssues = [];
    const seen = new Set();

    for (const { el, text } of textNodes(root)) {
      if (contrastIssues.length >= MAX_ISSUES) break;
      const key = `${describeEl(el)}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const style = getComputedStyle(el);
      const fg = parseColor(style.color);
      if (!fg) continue;
      const bg = effectiveBackground(el);
      const ratio = contrast(fg, bg);
      const minRequired = isMutedElement(el) ? MIN_MUTED_CONTRAST : MIN_CONTRAST;
      if (ratio < minRequired) {
        contrastIssues.push({
          selector: describeEl(el),
          text,
          ratio: Math.round(ratio * 100) / 100,
          minRequired,
          color: style.color,
          background: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`
        });
      }
    }

    const tableIssues = [];
    root.querySelectorAll(".table-wrap table").forEach((table, tableIndex) => {
      if (!isVisible(table)) return;
      const wrap = table.closest(".table-wrap");
      const label = table.getAttribute("aria-label") || `table-${tableIndex}`;

      const visibleTh = [...table.querySelectorAll("thead th")].filter((th) => isVisible(th));
      const visibleRows = [...table.querySelectorAll("tbody tr")].filter((tr) => isVisible(tr));

      if (visibleTh.length && visibleRows.length) {
        const refRow = visibleRows[0];
        const refTds = [...refRow.querySelectorAll("td")].filter((td) => isVisible(td));
        if (refTds.length !== visibleTh.length) {
          tableIssues.push({
            table: label,
            type: "column-count",
            headerCols: visibleTh.length,
            bodyCols: refTds.length
          });
        } else {
          for (let i = 0; i < visibleTh.length; i++) {
            const thRect = visibleTh[i].getBoundingClientRect();
            const tdRect = refTds[i].getBoundingClientRect();
            if (
              Math.abs(thRect.left - tdRect.left) > 2 ||
              Math.abs(thRect.width - tdRect.width) > 3
            ) {
              tableIssues.push({
                table: label,
                type: "column-misalign",
                column: i,
                header: visibleTh[i].textContent?.trim().slice(0, 40),
                deltaLeft: Math.round((tdRect.left - thRect.left) * 10) / 10,
                deltaWidth: Math.round((tdRect.width - thRect.width) * 10) / 10
              });
            }
          }
        }
      }

      if (wrap && table.scrollWidth > wrap.clientWidth + 2) {
        tableIssues.push({
          table: label,
          type: "horizontal-overflow",
          scrollWidth: table.scrollWidth,
          clientWidth: wrap.clientWidth
        });
      }
    });

    return { contrastIssues, tableIssues };
  }, rootSelector);
}

/** @param {import('@playwright/test').Page} page */
export async function openManagerTab(page, tabName) {
  const btn = page.locator(`#tabs .tab-btn[data-tab="${tabName}"]`);
  await btn.click();
  await page.locator("#pageTitle").waitFor({ state: "visible" });
  await page.waitForTimeout(300);
}
