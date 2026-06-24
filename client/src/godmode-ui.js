import { buildOrderGodmode, buildPositionGodmode } from "@enver/shared/production/godmode.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { aggregateOrderAttention } from "./attention.js";
import { positionsForOrder } from "./workflows.js";
import { escapeHtml } from "./utils.js";

const HEALTH_LABELS = {
  ok: "У нормі",
  warning: "Увага",
  blocked: "Заблоковано",
  overdue: "Прострочено"
};

export function resolveOrderGodmode(order, positions = []) {
  if (order?.godmode) return order.godmode;
  const related = positionsForOrder(order, positions);
  return buildOrderGodmode(order, related, { planDate: order.planDate });
}

export function resolvePositionGodmode(position) {
  if (position?.godmode) return position.godmode;
  return buildPositionGodmode(position, { planDate: position.planDate });
}

export function renderHealthBadge(health) {
  const h = health || "ok";
  return `<span class="godmode-health godmode-health--${escapeHtml(h)}">${escapeHtml(HEALTH_LABELS[h] || h)}</span>`;
}

export function renderAttentionBadge(score) {
  const s = Number(score) || 0;
  if (s < 40) return "";
  return `<span class="godmode-attention" title="Потребує уваги">Потребує уваги</span>`;
}

export function renderWarningsList(warnings = [], { compact = false } = {}) {
  if (!warnings.length) {
    return compact ? "" : '<p class="godmode-empty">Попереджень немає.</p>';
  }
  return `<ul class="godmode-warnings ${compact ? "godmode-warnings--compact" : ""}">
    ${warnings
      .map(
        (w) => `<li class="godmode-warning godmode-warning--${escapeHtml(w.level || "warning")}">
          <strong>${escapeHtml(w.title || "Увага")}</strong>
          <span>${escapeHtml(w.message || "")}</span>
        </li>`
      )
      .join("")}
  </ul>`;
}

export function renderBlockersList(blockers = []) {
  if (!blockers.length) return "";
  return `<ul class="godmode-blockers">
    ${blockers
      .map(
        (b) => `<li class="godmode-blocker">
          <strong>${escapeHtml(b.title || "Блокер")}</strong>
          <span>${escapeHtml(b.message || "")}</span>
        </li>`
      )
      .join("")}
  </ul>`;
}

export function renderNextActionBanner(godmode, { positionId = null, showCta = true } = {}) {
  const next = godmode?.nextAction;
  if (!next?.label) return "";

  const isBlocked = godmode?.health === "blocked" || next.allowed === false;
  const ctaAttrs =
    positionId && showCta && next.allowed !== false
      ? `data-run-next-action="${positionId}" data-action-type="${escapeHtml(next.type)}"`
      : "";

  return `
    <div class="godmode-next-banner ${isBlocked ? "godmode-next-banner--blocked" : ""}" role="status">
      <div class="godmode-next-body">
        <span class="godmode-next-kicker">${isBlocked ? "Потрібна дія" : "Головна дія"}</span>
        <strong class="godmode-next-label">${escapeHtml(next.label)}</strong>
        ${next.description ? `<p class="godmode-next-desc">${escapeHtml(next.description)}</p>` : ""}
        ${next.reason ? `<p class="godmode-next-reason">${escapeHtml(next.reason)}</p>` : ""}
      </div>
      ${
        showCta && next.buttonLabel
          ? `<button type="button" class="btn btn-primary godmode-next-cta" ${ctaAttrs} ${next.allowed === false ? "disabled" : ""}>${escapeHtml(next.buttonLabel)}</button>`
          : ""
      }
    </div>`;
}

export function renderOrderGodmodeSummary(order, positions = []) {
  const gm = resolveOrderGodmode(order, positions);
  const stage = gm.currentStage ? stageLabel(gm.currentStage) : "—";

  return `
    <section class="godmode-summary card" aria-label="Стан замовлення">
      <div class="godmode-summary-head">
        ${renderHealthBadge(gm.health)}
        ${renderAttentionBadge(gm.attentionScore)}
        <span class="godmode-summary-progress">${gm.progress ?? 0}%</span>
        <span class="godmode-summary-stage">${escapeHtml(stage)}</span>
      </div>
      ${renderBlockersList(gm.blockers)}
      ${renderWarningsList(gm.warnings, { compact: true })}
      ${renderNextActionBanner(gm)}
    </section>`;
}

export function renderSmartEmptyState({ icon = "✨", title, text, actionLabel, actionId }) {
  return `<div class="enver-empty-state godmode-empty-state">
    <span class="enver-empty-state-icon" aria-hidden="true">${icon}</span>
    <h3 class="enver-empty-state-title">${escapeHtml(title)}</h3>
    <p class="enver-empty-state-text">${escapeHtml(text)}</p>
    ${actionLabel && actionId ? `<button type="button" class="btn btn-primary" id="${escapeHtml(actionId)}">${escapeHtml(actionLabel)}</button>` : ""}
  </div>`;
}

/** Блоки для production floor з локального state.positions. */
export function buildFloorGodmodeBuckets(positions = []) {
  const roots = positions.filter((p) => !p.parentId);
  const buckets = {
    attention: [],
    overdue: [],
    awaitingConstructive: [],
    awaitingTasks: [],
    readyForInstall: [],
    problems: [],
    activeOperators: []
  };

  for (const p of roots) {
    const gm = resolvePositionGodmode(p);
    const entry = { position: p, godmode: gm };
    if (gm.attentionScore >= 40) buckets.attention.push(entry);
    if (gm.warnings.some((w) => w.type === "overdue")) buckets.overdue.push(entry);
    if (gm.warnings.some((w) => w.type === "missing_constructive"))
      buckets.awaitingConstructive.push(entry);
    if (gm.warnings.some((w) => w.type === "tasks_not_created")) buckets.awaitingTasks.push(entry);
    if (gm.warnings.some((w) => w.type === "ready_for_install"))
      buckets.readyForInstall.push(entry);
    if (p.problem?.trim() || gm.warnings.some((w) => w.type === "operator_problem")) {
      buckets.problems.push(entry);
    }
  }

  for (const key of Object.keys(buckets)) {
    if (key === "activeOperators") continue;
    buckets[key].sort((a, b) => b.godmode.attentionScore - a.godmode.attentionScore);
  }

  return buckets;
}

export function renderFloorGodmodeSection(buckets) {
  const section = (title, items, empty) => {
    if (!items.length) return "";
    const rows = items
      .slice(0, 8)
      .map(
        ({ position: p, godmode: gm }) =>
          `<button type="button" class="pf-godmode-row" data-edit-position="${p.id}">
            <strong>${escapeHtml(p.orderNumber)} · ${escapeHtml(p.item || "—")}</strong>
            <span>${escapeHtml(gm.nextAction?.label || "—")}</span>
            ${renderHealthBadge(gm.health)}
          </button>`
      )
      .join("");
    return `<section class="pf-section"><h2 class="pf-section-title">${escapeHtml(title)}</h2>${rows || `<p class="pf-empty">${empty}</p>`}</section>`;
  };

  return [
    section("Потребує уваги", buckets.attention, ""),
    section("Прострочені", buckets.overdue, ""),
    section("Очікують конструктив", buckets.awaitingConstructive, ""),
    section("Очікують задачі", buckets.awaitingTasks, ""),
    section("Готові до монтажу", buckets.readyForInstall, ""),
    section("Проблеми", buckets.problems, "")
  ].join("");
}

/** Fallback для карток — сумісність з aggregateOrderAttention. */
export function orderAttentionFromGodmode(order, positions) {
  const gm = resolveOrderGodmode(order, positions);
  const legacy = aggregateOrderAttention(order, positions);
  return {
    ...legacy,
    godmode: gm,
    nextAction: gm.nextAction,
    blockers: gm.blockers.map((b) => ({ ...b, severity: "high", message: b.message })),
    warnings: gm.warnings.map((w) => ({ ...w, severity: w.level, message: w.message })),
    attentionCount: gm.blockers.length + gm.warnings.filter((w) => w.level === "warning").length,
    maxOverdue: legacy.maxOverdue,
    hasProblem: legacy.hasProblem
  };
}
