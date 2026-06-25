/** Рання ініціалізація теми до першого paint (без inline script у HTML). */
(function initThemeEarly() {
  try {
    const stored = localStorage.getItem("enver_theme");
    const theme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  } catch {
    /* ignore */
  }
})();
