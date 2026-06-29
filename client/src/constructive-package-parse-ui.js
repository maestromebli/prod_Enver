import { escapeHtml } from "./utils.js";
import { api } from "./api.js";
import { state } from "./state.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  CONSTRUCTIVE_PIPELINE_STEPS,
  constructivePipelineStepIndex,
  isPackageParsedStatus,
  isStalePackageParsing,
  packageParseDisplay,
  packageStatusLabel
} from "@enver/shared/production/constructive-package.js";

const PARSE_PROGRESS_MESSAGES = [
  "Читаємо файли пакета…",
  "Розбираємо Excel-специфікацію…",
  "Витягуємо деталі з .project / .b3d…",
  "Зіставляємо 3D-модель…",
  "Зберігаємо деталі та матеріали…"
];

const PARSE_REQUEST_TIMEOUT_MS = 180_000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

export function renderConstructivePipeline(status) {
  const current = constructivePipelineStepIndex(status);
  const parsing = status === "parsing";
  const steps = CONSTRUCTIVE_PIPELINE_STEPS.map((s, i) => {
    let cls = "";
    if (i < current) cls = "is-done";
    else if (i === current) cls = "is-active";
    if (parsing && s.key === "parse") cls = "is-active is-parsing";
    return `<span class="cp-pipe-step ${cls}" data-step="${escapeHtml(s.key)}">${escapeHtml(s.label)}</span>`;
  });
  return `<div class="cp-pipeline" data-cp-pipeline>${steps.join('<span class="cp-pipe-arrow">→</span>')}</div>`;
}

export function renderPackageParseBanner(detail) {
  const pkg = detail?.package;
  if (!pkg) return "";

  const stale = isStalePackageParsing(pkg);
  const display = packageParseDisplay(pkg.status, detail?.parts?.length || 0);
  const modifier = stale
    ? "cp-parse-banner--pending"
    : display.parsing
      ? "cp-parse-banner--parsing"
      : display.parsed
        ? "cp-parse-banner--parsed"
        : "cp-parse-banner--pending";

  const progress =
    display.parsing && !stale
      ? `<div class="cp-parse-progress" aria-hidden="true"><div class="cp-parse-progress-bar" data-cp-parse-progress-bar></div></div>
       <p class="cp-parse-progress-text enver-meta" data-cp-parse-progress-text>${escapeHtml(PARSE_PROGRESS_MESSAGES[0])}</p>`
      : "";

  const staleActions = stale
    ? `<p class="cp-parse-stale-note enver-meta">Розбір перервався або завис. Спробуйте ще раз.</p>
       <button type="button" class="btn btn-sm btn-primary" data-cp-parse-retry>Розібрати знову</button>`
    : "";

  return `
    <div class="cp-parse-banner ${modifier}" data-cp-parse-banner role="status" aria-live="polite">
      <div class="cp-parse-banner-main">
        <strong class="cp-parse-banner-title">${escapeHtml(stale ? "Розбір не завершено" : display.title)}</strong>
        <span class="enver-meta cp-parse-banner-sub">${escapeHtml(stale ? "Натисніть «Розібрати знову»" : display.subtitle)}</span>
      </div>
      ${progress}
      ${staleActions}
    </div>`;
}

export function applyPackageParseBanner(block, detail) {
  if (!block) return;
  const html = renderPackageParseBanner(detail);
  let banner = block.querySelector("[data-cp-parse-banner]");
  if (!html) {
    banner?.remove();
    return;
  }
  if (banner) {
    banner.outerHTML = html;
  } else {
    const anchor = block.querySelector(".cp-pipeline") || block.querySelector(".cp-status");
    if (anchor) {
      anchor.insertAdjacentHTML("afterend", html);
    } else {
      block.querySelector("[data-cp-package-files]")?.insertAdjacentHTML("afterbegin", html);
    }
  }
}

export function applyPackageStatusLine(block, detail) {
  const pkg = detail?.package;
  const statusEl = block?.querySelector(".cp-status");
  if (!statusEl || !pkg) return;

  const display = packageParseDisplay(pkg.status, detail?.parts?.length || 0);
  const parts = detail?.parts?.length ? ` · ${detail.parts.length} деталей` : "";
  statusEl.textContent = `${display.title}${parts}`;
  statusEl.classList.toggle("cp-status--parsed", display.parsed);
  statusEl.classList.toggle("cp-status--parsing", display.parsing);
  statusEl.classList.toggle("cp-status--pending", !display.parsed && !display.parsing);
}

function startParseProgressAnimation(block) {
  const bar = block?.querySelector("[data-cp-parse-progress-bar]");
  const text = block?.querySelector("[data-cp-parse-progress-text]");
  if (!bar) return () => {};

  let pct = 8;
  let msgIdx = 0;
  bar.style.width = `${pct}%`;

  const tick = setInterval(() => {
    pct = Math.min(pct + 4 + Math.random() * 6, 92);
    bar.style.width = `${pct}%`;
    const nextMsg = Math.floor(pct / 20);
    if (text && nextMsg !== msgIdx && PARSE_PROGRESS_MESSAGES[nextMsg]) {
      msgIdx = nextMsg;
      text.textContent = PARSE_PROGRESS_MESSAGES[msgIdx];
    }
  }, 900);

  return () => clearInterval(tick);
}

function withParsingStatus(detail) {
  if (!detail?.package) return detail;
  return {
    ...detail,
    package: { ...detail.package, status: "parsing" }
  };
}

/**
 * Розбір пакета з опитуванням статусу parsing і прогресом у UI.
 */
export async function runPackageParseWithProgress(positionId, packageId, ctx = {}) {
  const { root, position, liveCtx, notify, onComplete } = ctx;
  const block = root?.querySelector?.(".constructive-package-block");

  const optimistic = withParsingStatus(
    liveCtx?.detail || { package: { status: "parsing", id: packageId } }
  );
  if (block && position) {
    applyPackageParseUi(block, position, optimistic);
  }

  const stopProgress = startParseProgressAnimation(block);
  let pollTimer = null;

  const poll = async () => {
    try {
      const detail = await api.getConstructivePackageLatest(positionId);
      if (detail?.package?.status === "parsing") {
        liveCtx.detail = detail;
        if (block && position) applyPackageParseUi(block, position, detail);
        notify?.();
      }
    } catch {
      /* ignore */
    }
  };

  pollTimer = setInterval(poll, 1000);
  await poll();

  try {
    const after = await withTimeout(
      api.parseConstructivePackage(positionId, packageId),
      PARSE_REQUEST_TIMEOUT_MS,
      "Розбір занадто довгий — спробуйте ще раз або завантажте менші файли"
    );
    liveCtx.detail = after;
    liveCtx.onDetailPatched?.(after);
    if (block && position) applyPackageParseUi(block, position, after);
    notify?.();
    onComplete?.(after);
    return after;
  } finally {
    clearInterval(pollTimer);
    stopProgress();
    const bar = block?.querySelector("[data-cp-parse-progress-bar]");
    if (bar) bar.style.width = "100%";
  }
}

export function applyPackageParseUi(block, position, detail, _constructiveFiles) {
  if (!block) return;

  const pkg = detail?.package;
  if (pkg) {
    const pipeline =
      block.querySelector("[data-cp-pipeline]") || block.querySelector(".cp-pipeline");
    if (pipeline) {
      pipeline.outerHTML = renderConstructivePipeline(pkg.status);
    }
  }

  applyPackageParseBanner(block, detail);
  applyPackageStatusLine(block, detail);

  const uploadZone = block.querySelector("[data-cp-package-drop]");
  if (uploadZone) {
    uploadZone.dataset.state = detail?.files?.length ? "success" : "idle";
    const title = uploadZone.querySelector(".constructive-upload-title");
    if (title) {
      title.textContent = detail?.files?.length ? "Додати файли" : "Завантажити файли пакета";
    }
  }

  const parsing = pkg?.status === "parsing" && !isStalePackageParsing(pkg);
  block.classList.toggle("constructive-package-block--parsing", parsing);
  block.querySelectorAll("[data-cp-parse-btn]").forEach((btn) => {
    btn.disabled = parsing;
    if (parsing) btn.textContent = "Розбір…";
    else if (btn.dataset.cpParseDefaultLabel) btn.textContent = btn.dataset.cpParseDefaultLabel;
  });
}

/** Оновити UI після завантаження detail — зняти «вічний» parsing. */
export async function refreshStalePackageParseUi(block, position, detail, onRetry) {
  if (!block || !detail?.package?.id) return detail;
  if (!isStalePackageParsing(detail.package)) return detail;
  try {
    const fresh = await api.getConstructivePackageLatest(position.id);
    if (fresh) {
      applyPackageParseUi(block, position, fresh);
      block.querySelector("[data-cp-parse-retry]")?.addEventListener("click", () => {
        onRetry?.(fresh.package.id);
      });
      return fresh;
    }
  } catch {
    /* ignore */
  }
  applyPackageParseUi(block, position, detail);
  block.querySelector("[data-cp-parse-retry]")?.addEventListener("click", () => {
    onRetry?.(detail.package.id);
  });
  return detail;
}

/** Запланувати автоматичний розбір після відкриття панелі пакета. */
export function requestAutoParsePackage(positionId) {
  if (!positionId) return;
  state.ordersView = state.ordersView || {};
  state.ordersView.autoParsePackagePositionId = Number(positionId);
}

/** Чи запитано автопарс для позиції (без зняття прапорця). */
export function isAutoParsePackageRequested(positionId) {
  return Number(state.ordersView?.autoParsePackagePositionId) === Number(positionId);
}

/**
 * Запустити розбір, якщо користувач натиснув godmode «Розібрати».
 * @returns {boolean} чи виконано запит
 */
export async function runAutoParsePackageIfRequested(positionId, ctx = {}) {
  if (!isAutoParsePackageRequested(positionId)) return false;
  state.ordersView.autoParsePackagePositionId = null;

  const { root, position, liveCtx, notify, onComplete } = ctx;
  let latest = liveCtx?.detail;
  try {
    latest = await api.getConstructivePackageLatest(positionId);
  } catch {
    /* ignore */
  }

  const packageId = latest?.package?.id;
  if (!packageId) {
    toastError("Спочатку завантажте файли пакета");
    return true;
  }

  const pkg = latest.package;
  if (pkg.status === "parsing" && !isStalePackageParsing(pkg)) {
    return true;
  }
  if (isPackageParsedStatus(pkg.status) && latest.parts?.length) {
    return true;
  }

  try {
    const after = await runPackageParseWithProgress(positionId, packageId, {
      root,
      position: position || { id: positionId },
      liveCtx: liveCtx || { detail: latest },
      notify,
      onComplete
    });
    if (after?.autoProcurement || after?.procurement?.id) {
      toastSuccess("Пакет розібрано — закупівлю створено з Excel");
    } else {
      toastSuccess("Пакет розібрано");
    }
  } catch (err) {
    toastError(err.message);
  }
  return true;
}

export { packageStatusLabel };
