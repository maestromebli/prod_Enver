const STORAGE_KEY = "enver_theme";
export const THEMES = ["light", "dark"];

function prefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
}

export function getStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(stored) ? stored : null;
}

export function getEffectiveTheme() {
  return getStoredTheme() ?? (prefersDark() ? "dark" : "light");
}

export function applyTheme(theme) {
  const resolved = THEMES.includes(theme) ? theme : "light";
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function setTheme(theme) {
  const resolved = applyTheme(theme);
  localStorage.setItem(STORAGE_KEY, resolved);
  syncThemeToggle(resolved);
  return resolved;
}

export function toggleTheme() {
  const next = getEffectiveTheme() === "dark" ? "light" : "dark";
  return setTheme(next);
}

function syncThemeToggle(theme) {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;
  const isDark = theme === "dark";
  btn.setAttribute("aria-pressed", isDark ? "true" : "false");
  btn.setAttribute("aria-label", isDark ? "Увімкнути світлу тему" : "Увімкнути темну тему");
  btn.title = isDark ? "Світла тема" : "Темна тема";
  btn.querySelector(".theme-icon-sun")?.toggleAttribute("hidden", isDark);
  btn.querySelector(".theme-icon-moon")?.toggleAttribute("hidden", !isDark);
}

export function initTheme() {
  applyTheme(getEffectiveTheme());
  const btn = document.getElementById("themeToggleBtn");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => toggleTheme());
  syncThemeToggle(getEffectiveTheme());
}
