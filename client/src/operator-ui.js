/** Єдиний режим UI оператора: index.html, operator.html, PWA, APK. */

import { isOperator } from "./auth.js";
import { isNativeOperatorShell } from "./operator-native.js";

const BUILD_STORAGE_KEY = "enver_app_build";
const INSTALLED_POLL_MS = 30_000;
const BROWSER_POLL_MS = 5 * 60_000;
const SW_UPDATE_POLL_MS = 60_000;

/** Збірка, вшита в JS під час Vite build (Docker CI). */
const PAGE_BUILD =
  typeof __ENVER_APP_BUILD__ !== "undefined" ? String(__ENVER_APP_BUILD__ || "").trim() : "";

let buildWatchStarted = false;
let reloadingForBuild = false;

export function isOperatorUiMode() {
  const body = document.body;
  if (!body) return false;
  return body.classList.contains("enver-operator-ui") || body.classList.contains("view-operator");
}

export function isCuttingOneScreen(stageKey) {
  return stageKey === "cutting" && isOperatorUiMode();
}

/** PWA на головному екрані, fullscreen або Android WebView (APK). */
export function isInstalledClient() {
  if (isNativeOperatorShell()) return true;
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

/** Класи для operator.html / PWA / APK: safe-area, компактна шапка, enver-тема. */
export function initOperatorPwaShell() {
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;
  if (
    body.classList.contains("operator-client-mode") ||
    isInstalledClient() ||
    isNativeOperatorShell()
  ) {
    root.classList.add("operator-pwa-capable");
  }
  root.classList.toggle("enver-operator-installed", isInstalledClient());
}

export function setOperatorUiActive(active) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("view-operator", active);
  // operator.html завжди має operator-client-mode у розмітці; index — лише під час view=operator.
  const keepOperatorShell = body.classList.contains("operator-client-mode") || active;
  body.classList.toggle("enver-operator-ui", keepOperatorShell);
}

/** Операторів з index.html перенаправляє на /operator.html — той самий UI, що PWA/APK. */
export function redirectPureOperatorToClientPage() {
  if (document.body?.classList.contains("operator-client-mode")) return false;
  if (!isOperator()) return false;
  const url = new URL("/operator.html", window.location.origin);
  const incoming = new URLSearchParams(window.location.search);
  for (const key of ["stage", "position"]) {
    const value = incoming.get(key);
    if (value) url.searchParams.set(key, value);
  }
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
  return true;
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
  if (reloadingForBuild) return false;

  const build = await fetchAppBuildLabel();
  if (!build) return false;

  const stored = localStorage.getItem(BUILD_STORAGE_KEY);
  const pageStale = Boolean(PAGE_BUILD && PAGE_BUILD !== "dev" && PAGE_BUILD !== build);
  const serverChanged = Boolean(stored && stored !== build);

  if (pageStale || serverChanged) {
    reloadingForBuild = true;
    localStorage.setItem(BUILD_STORAGE_KEY, build);
    if ("serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        /* ignore */
      }
    }
    const url = new URL(location.href);
    url.searchParams.set("_b", build.slice(0, 12));
    location.replace(`${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  localStorage.setItem(BUILD_STORAGE_KEY, build);
  return false;
}

/** Версія JS, що зараз виконується в браузері/WebView. */
export function getLoadedAppBuildLabel() {
  return PAGE_BUILD || null;
}

/** Для Android WebView: виклик з onResume через window.__enverCheckForUpdates. */
export function checkForAppUpdates() {
  return reloadIfAppBuildChanged();
}

function shouldPollBuildNow() {
  return document.visibilityState === "visible" || isInstalledClient();
}

export function watchAppBuildUpdates() {
  if (buildWatchStarted) return;
  buildWatchStarted = true;

  const tick = () => {
    if (!shouldPollBuildNow()) return;
    reloadIfAppBuildChanged();
  };

  document.addEventListener("visibilitychange", tick);
  window.addEventListener("focus", tick);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) tick();
  });

  const pollMs = isInstalledClient() ? INSTALLED_POLL_MS : BROWSER_POLL_MS;
  setInterval(tick, pollMs);
  tick();

  window.__enverCheckForUpdates = checkForAppUpdates;
}

/** Service worker для operator.html — мережевий кеш JS/CSS і автооновлення після деплою. */
export function registerOperatorServiceWorker() {
  // У WebView (APK) SW лише ускладнює кешування — оновлення через polling /api/health.
  if (isNativeOperatorShell()) return;
  if (!("serviceWorker" in navigator)) return;

  // Перша активація SW (null → controller) — не перезавантажуємо, інакше F5 дає подвійний reload.
  let skipNextControllerChange = !navigator.serviceWorker.controller;
  let reloadingForSw = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (skipNextControllerChange) {
      skipNextControllerChange = false;
      return;
    }
    if (reloadingForSw) return;
    reloadingForSw = true;
    location.reload();
  });

  navigator.serviceWorker
    .register("/sw-operator.js", { updateViaCache: "none" })
    .then((reg) => {
      const checkUpdate = () => reg.update().catch(() => {});
      checkUpdate();
      setInterval(checkUpdate, SW_UPDATE_POLL_MS);

      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            reloadIfAppBuildChanged();
          }
        });
      });
    })
    .catch(() => {});
}
