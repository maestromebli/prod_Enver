import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const designSystemCss = readFileSync(
  join(__dirname, "../src/styles/enver-design-system.css"),
  "utf8"
);

function parseCssColor(value) {
  if (!value) return null;
  const hex = value.match(/^(#[0-9a-fA-F]{3,8})$/);
  if (hex) return [...expandHex(hex[1]), 1];
  const rgba = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      rgba[4] !== undefined ? Number(rgba[4]) : 1
    ];
  }
  return null;
}

function parseThemeVars(css, themeBlock = ":root") {
  const blockRe =
    themeBlock === ":root" ? /:root\s*\{([^}]+)\}/s : /\[data-theme="dark"\]\s*\{([^}]+)\}/s;
  const match = css.match(blockRe);
  if (!match) return {};
  const vars = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/(--enver-[\w-]+)\s*:\s*([^;]+);/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

function blendFgOnBg(fg, bg) {
  const a = fg[3];
  return [
    Math.round(bg[0] * (1 - a) + fg[0] * a),
    Math.round(bg[1] * (1 - a) + fg[1] * a),
    Math.round(bg[2] * (1 - a) + fg[2] * a),
    1
  ];
}

function resolveTokenColor(vars, name) {
  const raw = vars[name];
  if (!raw) return null;
  const color = parseCssColor(raw);
  if (!color) return null;
  if (color[3] >= 0.99) return color;
  const surface = parseCssColor(vars["--enver-surface"]);
  if (!surface) return color;
  return blendFgOnBg(color, surface);
}

function contrastTokenPair(vars, fgName, bgName) {
  const fg = resolveTokenColor(vars, fgName);
  const bg = resolveTokenColor(vars, bgName);
  if (!fg || !bg) return null;
  return contrastRatio(
    `#${fg
      .slice(0, 3)
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")}`,
    `#${bg
      .slice(0, 3)
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")}`
  );
}

function expandHex(hex) {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return h.split("").map((c) => Number.parseInt(c + c, 16));
  }
  const num = Number.parseInt(h.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function luminance([r, g, b]) {
  const ch = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(hexFg, hexBg) {
  const l1 = luminance(expandHex(hexFg));
  const l2 = luminance(expandHex(hexBg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const TOKEN_PAIRS = [
  { fg: "--enver-text", bg: "--enver-surface", min: 4.5, label: "основний текст" },
  { fg: "--enver-text-muted", bg: "--enver-surface", min: 3, label: "приглушений текст" },
  { fg: "--enver-text-soft", bg: "--enver-surface", min: 2.8, label: "другорядний текст" },
  { fg: "--enver-primary", bg: "--enver-primary-soft", min: 3, label: "акцент на м'якому фоні" },
  { fg: "--enver-success", bg: "--enver-success-soft", min: 3, label: "успіх" },
  { fg: "--enver-warning", bg: "--enver-warning-soft", min: 3, label: "попередження" },
  { fg: "--enver-danger", bg: "--enver-danger-soft", min: 3, label: "небезпека" },
  { fg: "--enver-info", bg: "--enver-info-soft", min: 3, label: "інфо" },
  { fg: "--enver-text", bg: "--enver-bg", min: 4, label: "текст на фоні сторінки" },
  { fg: "--enver-text-muted", bg: "--enver-surface-soft", min: 3, label: "muted на surface-soft" }
];

function auditTheme(vars, themeName) {
  const failures = [];
  for (const pair of TOKEN_PAIRS) {
    const ratio = contrastTokenPair(vars, pair.fg, pair.bg);
    if (ratio === null) continue;
    if (ratio < pair.min) {
      failures.push(
        `${themeName}: ${pair.label} (${pair.fg} на ${pair.bg}) — ${ratio.toFixed(2)}:1, мін. ${pair.min}:1`
      );
    }
  }
  return failures;
}

describe("Візуальні токени дизайн-системи", () => {
  it("пари кольорів мають достатній контраст у світлій темі", () => {
    const light = parseThemeVars(designSystemCss, ":root");
    const failures = auditTheme(light, "light");
    assert.deepEqual(failures, []);
  });

  it("пари кольорів мають достатній контраст у темній темі", () => {
    const dark = {
      ...parseThemeVars(designSystemCss, ":root"),
      ...parseThemeVars(designSystemCss, "dark")
    };
    const failures = auditTheme(dark, "dark");
    assert.deepEqual(failures, []);
  });
});
