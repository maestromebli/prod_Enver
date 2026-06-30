import { stageLabel } from "@enver/shared/production/stages.js";
import { buildGodmodeCtaAttrs } from "@enver/shared/production/godmode-ui-helpers.js";
import { resolvePositionGodmode } from "./godmode-ui.js";
import { state } from "./state.js";
import { escapeHtml, badge } from "./utils.js";

export const POSITION_SUB_TAB_LABELS = {
  manager: "Дані",
  constructive: "Пакет конструктива",
  procurement: "Закупівля",
  cnc: "ЧПК",
  install: "Монтаж",
  operator: "Оператор",
  history: "Історія"
};

function findOrder(position) {
  if (position?.orderId) {
    return state.orders.find((o) => o.id === position.orderId) || null;
  }
  const num = String(position?.orderNumber || "").trim();
  if (!num) return null;
  return state.orders.find((o) => o.orderNumber === num) || null;
}

function responsibleLabel(position) {
  const constructor = String(position?.constructorUserName || position?.constructor || "").trim();
  const assembler = String(position?.assemblyResponsible || "").trim();
  if (constructor && assembler) return `${constructor} · ${assembler}`;
  return constructor || assembler || "";
}

/**
 * Універсальний breadcrumb ENVER.
 * @param {{ label: string, action?: string }[]} items
 */
export function renderEnverBreadcrumb(items, { ariaLabel = "Навігація" } = {}) {
  const parts = (items || []).map((item, index) => {
    const isLast = index === items.length - 1;
    const sep = index > 0 ? '<span class="pos-ctx-crumb-sep" aria-hidden="true">›</span>' : "";
    if (item.action && !isLast) {
      return `${sep}<button type="button" class="pos-ctx-crumb-link" data-enver-crumb="${escapeHtml(item.action)}">${escapeHtml(item.label)}</button>`;
    }
    if (isLast) {
      return `${sep}<span class="pos-ctx-crumb-tab" aria-current="page">${escapeHtml(item.label)}</span>`;
    }
    return `${sep}<span class="pos-ctx-crumb-pos">${escapeHtml(item.label)}</span>`;
  });
  return `<nav class="pos-ctx-crumb enver-breadcrumb" aria-label="${escapeHtml(ariaLabel)}">${parts.join("")}</nav>`;
}

export function bindEnverBreadcrumb(root, handlers = {}) {
  if (!root) return;
  root.querySelectorAll("[data-enver-crumb]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const action = btn.dataset.enverCrumb;
      handlers[action]?.();
    });
  });
  root.querySelector("[data-pos-ctx-back]")?.addEventListener("click", (e) => {
    e.preventDefault();
    handlers["orders-overview"]?.();
  });
}

function renderStickyBar(position, godmode, order) {
  const next = godmode?.nextAction;
  if (!next?.label) return "";

  const isBlocked = godmode?.health === "blocked" || next.allowed === false;
  const ctaAttrs =
    next.allowed !== false
      ? buildGodmodeCtaAttrs(next, { positionId: position.id, orderId: order?.id ?? null })
      : "";
  const ctaLabel = next.buttonLabel || "Виконати";
  const ctaBtn =
    ctaAttrs && next.allowed !== false
      ? `<button type="button" class="enver-sticky-bar-cta" ${ctaAttrs}>${escapeHtml(ctaLabel)}</button>`
      : "";

  return `
    <div class="enver-sticky-bar pos-ctx-sticky ${isBlocked ? "enver-sticky-bar--blocked" : ""}" role="region" aria-label="Головна дія позиції">
      <div class="enver-sticky-bar-text">
        <span class="enver-sticky-bar-kicker">${isBlocked ? "Потрібна дія" : "Далі"}</span>
        <strong>${escapeHtml(next.label)}</strong>
      </div>
      <div class="enver-sticky-bar-actions">${ctaBtn}</div>
    </div>`;
}

/** Sticky context bar для вкладки позиції. */
export function renderPositionContextBar(position, { subTab = "manager", gm = null } = {}) {
  if (!position?.id) return "";

  const godmode = gm || resolvePositionGodmode(position);
  const order = findOrder(position);
  const orderLabel = order?.orderNumber || position.orderNumber || "—";
  const tabLabel = POSITION_SUB_TAB_LABELS[subTab] || subTab;
  const stage = stageLabel(position.currentStage || "constructor");
  const pct = Math.min(100, Math.max(0, Number(position.progress) || 0));
  const status = position.positionStatus || "—";
  const responsible = responsibleLabel(position);
  const next = godmode?.nextAction;
  const isBlocked = godmode?.health === "blocked" || next?.allowed === false;

  let ctaHtml = "";
  if (next?.label && next.allowed !== false) {
    const ctaAttrs = buildGodmodeCtaAttrs(next, {
      positionId: position.id,
      orderId: order?.id ?? null
    });
    if (ctaAttrs) {
      ctaHtml = `<button type="button" class="pos-ctx-cta btn btn-primary btn-sm" ${ctaAttrs}>${escapeHtml(next.buttonLabel || "Виконати")}</button>`;
    }
  }

  const breadcrumb = renderEnverBreadcrumb(
    [
      { label: "Замовлення", action: "orders-overview" },
      { label: orderLabel },
      { label: position.item || "Позиція" },
      { label: tabLabel }
    ],
    { ariaLabel: "Навігація позиції" }
  );

  const stickyBar = renderStickyBar(position, godmode, order);
  const hasSticky = Boolean(stickyBar);

  return `
    <div class="pos-ctx-wrap${hasSticky ? " pos-ctx-wrap--sticky-mobile" : ""}">
      <div class="pos-ctx-bar" role="region" aria-label="Контекст позиції">
        ${breadcrumb}
        <div class="pos-ctx-meta">
          <span class="pos-ctx-chip pos-ctx-chip--status">${badge(status)}</span>
          <span class="pos-ctx-chip pos-ctx-chip--stage">${escapeHtml(stage)}</span>
          <span class="pos-ctx-chip pos-ctx-chip--pct" title="Прогрес">${pct}%</span>
          ${
            responsible
              ? `<span class="pos-ctx-chip pos-ctx-chip--person" title="Відповідальний">${escapeHtml(responsible)}</span>`
              : ""
          }
        </div>
        ${
          next?.label
            ? `<div class="pos-ctx-action ${isBlocked ? "pos-ctx-action--blocked" : ""}">
                <div class="pos-ctx-action-text">
                  <span class="pos-ctx-action-kicker">${isBlocked ? "Потрібна дія" : "Далі"}</span>
                  <strong>${escapeHtml(next.label)}</strong>
                </div>
                ${ctaHtml}
              </div>`
            : ""
        }
      </div>
      ${stickyBar}
    </div>`;
}

export function bindPositionContextBar(root, { onBack } = {}) {
  bindEnverBreadcrumb(root, { "orders-overview": onBack });
}
