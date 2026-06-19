/** Єдиний режим UI оператора: index.html, operator.html, PWA, APK. */

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
