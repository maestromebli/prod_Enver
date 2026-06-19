/** Єдиний режим UI оператора: index.html, operator.html, PWA, APK. */

const BUILD_STORAGE_KEY = "enver_app_build";

export function isOperatorUiMode() {
  const body = document.body;
  if (!body) return false;
  return body.classList.contains("enver-operator-ui") || body.classList.contains("view-operator");
}

export function isCuttingOneScreen(stageKey) {
  return stageKey === "cutting" && isOperatorUiMode();
}

export function setOperatorUiActive(active) {
  document.body?.classList.toggle("enver-operator-ui", active);
  document.body?.classList.toggle("view-operator", active);
}

/** Версія збірки з /api/health (v2 і legacy). */
export async function fetchAppBuildLabel() {
  try {
    const raw = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
    const build = String(raw?.data?.build ?? raw?.build ?? "").trim();
    return build || null;
  } catch {
    return null;
  }
}

export async function syncOperatorBuildChip(elementId = "operatorBuildChip") {
  const chip = document.getElementById(elementId);
  if (!chip) return;
  const build = await fetchAppBuildLabel();
  if (!build) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  chip.textContent = build.slice(0, 7);
  chip.title = `Версія сервера: ${build}`;
}

/** Після деплою — перезавантажити вкладку, якщо збірка на сервері змінилась. */
export async function reloadIfAppBuildChanged() {
  const build = await fetchAppBuildLabel();
  if (!build) return false;

  const stored = localStorage.getItem(BUILD_STORAGE_KEY);
  if (stored && stored !== build) {
    localStorage.setItem(BUILD_STORAGE_KEY, build);
    if ("serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        /* ignore */
      }
    }
    location.reload();
    return true;
  }

  localStorage.setItem(BUILD_STORAGE_KEY, build);
  return false;
}

export function watchAppBuildUpdates() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reloadIfAppBuildChanged();
  });
}
