import { PIPELINE_STAGES, STAGE_STATUS_DONE, stageLabel } from "@enver/shared/production/stages.js";
import {
  getWorkPositions,
  getPositionTabLabel
} from "@enver/shared/production/order-position-model.js";
import { canEditOrders, canEditPositions } from "./auth.js";
import { state } from "./state.js";
import { badge, escapeHtml, progressRing } from "./utils.js";
import { formatObjectHeader } from "@enver/shared/production/object-display.js";
import {
  renderOrderGodmodeSummary,
  renderSmartEmptyState,
  resolveOrderGodmode,
  resolvePositionGodmode
} from "./godmode-ui.js";
import { buildGodmodeCtaAttrs } from "@enver/shared/production/godmode-ui-helpers.js";
import { formatHistoryTime, renderChangesList } from "./history.js";
import { STAGES, getStageStatus } from "./workflows.js";
import { getPositionSubTab, renderPositionOrderTab } from "./position-order-tab.js";
import { canViewOrder3DTab } from "./order-3d/order-3d-permissions.js";
import { renderOrder3DTab } from "./order-3d/order-3d-tab.js";
import { getCachedOrder3DAsset } from "./order-3d/order-3d-bind.js";

function buildDetailTabs(order, related, activeTab) {
  const work = getWorkPositions(order, related);
  const tabs = [{ key: "overview", label: "Огляд" }];
  work.forEach((p, i) => {
    tabs.push({ key: `pos-${p.id}`, label: getPositionTabLabel(p, i) });
  });
  if (canViewOrder3DTab()) {
    tabs.push({ key: "model-3d", label: "3D модель" });
  }
  tabs.push({ key: "history", label: "Історія" });
  const buttons = tabs
    .map(
      (t) =>
        `<button type="button" class="enver-segmented-btn ${activeTab === t.key ? "active" : ""}" data-order-detail-tab="${t.key}" role="tab" aria-selected="${activeTab === t.key}">${escapeHtml(t.label)}</button>`
    )
    .join("");
  return `<nav class="enver-segmented order-detail-tabs" role="tablist" aria-label="Розділи замовлення">${buttons}</nav>`;
}

/** Середній прогрес робочих позицій замовлення (0–100). */
export function orderProgress(order, related) {
  const work = getWorkPositions(order, related);
  if (!work.length) return 0;
  const sum = work.reduce((acc, p) => acc + (p.progress ?? 0), 0);
  return Math.round(sum / work.length);
}

function metaLine(parts) {
  const items = parts.filter(Boolean);
  return items.length ? `<p class="order-hero-meta">${items.join(" · ")}</p>` : "";
}

function renderOrderHero(order, related, activeTab = "overview") {
  const work = getWorkPositions(order, related);
  const progress = orderProgress(order, related);
  const canEdit = canEditOrders();
  const extras = [
    order.manager ? `Менеджер: ${escapeHtml(order.manager)}` : "",
    order.planDate ? `План ${escapeHtml(order.planDate)}` : "",
    order.startDate ? `Запуск ${escapeHtml(order.startDate)}` : "",
    order.priority && order.priority !== "Звичайний" ? escapeHtml(order.priority) : ""
  ].filter(Boolean);

  let positionLine = "";
  if (activeTab.startsWith("pos-")) {
    const positionId = Number(activeTab.slice(4));
    const position = work.find((p) => p.id === positionId);
    const positionName = String(position?.item ?? "").trim();
    if (positionName) {
      positionLine = `<p class="order-hero-position">${escapeHtml(positionName)}</p>`;
    }
  }

  const { title: objectTitle } = formatObjectHeader(order);

  return `
    <header class="order-hero card">
      <button type="button" class="order-hero-back" data-orders-back>← Замовлення</button>
      <div class="order-hero-main">
        <div class="order-hero-text">
          <h2 class="order-hero-title enver-page-title">${escapeHtml(objectTitle)}</h2>
          ${order.client ? `<p class="order-hero-client enver-meta">${escapeHtml(order.client)}</p>` : ""}
          ${positionLine}
          <div class="order-hero-tags">
            ${badge(order.status || "—")}
            <span class="stage-pill">${escapeHtml(work.length ? `${work.length} поз.` : "Без позицій")}</span>
          </div>
          ${extras.length ? metaLine(extras) : ""}
          ${order.comment?.trim() ? `<p class="order-hero-comment">${escapeHtml(order.comment)}</p>` : ""}
        </div>
        ${progressRing(progress, { size: 64 })}
      </div>
      ${canEdit ? `<button type="button" class="order-hero-edit btn btn-sm" data-edit-order="${order.id}">Редагувати</button>` : ""}
    </header>`;
}

function renderDetailTabs(order, related, activeTab) {
  return buildDetailTabs(order, related, activeTab);
}

function stepDotClass(position, stage) {
  const status = getStageStatus(position, stage);
  if (status === "Проблема") return "step-dot--problem";
  if (STAGE_STATUS_DONE.has(status)) return "step-dot--done";
  if (position.currentStage === stage.key) return "step-dot--current";
  if (status !== "Не розпочато") return "step-dot--active";
  return "";
}

function renderStepTrack(position, { canEdit, labeled = false }) {
  const stages = PIPELINE_STAGES;
  const dots = stages
    .map((stage, i) => {
      const status = getStageStatus(position, stage);
      const cls = stepDotClass(position, stage);
      const clickable = canEdit
        ? `data-step-jump="${stage.key}" data-position-id="${position.id}"`
        : "";
      const label = labeled ? `<span class="step-label">${escapeHtml(stage.label)}</span>` : "";
      const sep = i < stages.length - 1 ? '<span class="step-line" aria-hidden="true"></span>' : "";
      return `<div class="step-node">
        <button type="button" class="step-dot ${cls}" ${clickable} title="${escapeHtml(stage.label)}: ${escapeHtml(status)}" aria-label="${escapeHtml(stage.label)}"></button>
        ${label}
      </div>${sep}`;
    })
    .join("");
  return `<div class="step-track ${labeled ? "step-track--labeled" : ""}" role="list" aria-label="Етапи">${dots}</div>`;
}

function canAdvancePosition(position) {
  const stage = STAGES.find((s) => s.key === position.currentStage);
  if (!stage) return false;
  const status = getStageStatus(position, stage);
  return status !== "Готово" && status !== "Не потрібно";
}

function renderPositionRow(row, { canEdit }) {
  const { position: p, depth, isSub, childCount } = row;
  const indent = depth > 0 ? `style="--order-pos-depth:${depth}"` : "";
  const currentLabel = stageLabel(p.currentStage || "constructor");
  const showAdvance = canEdit && canAdvancePosition(p);
  const problem = p.problem?.trim();

  const toggleBtn =
    !isSub && childCount > 0
      ? `<button type="button" class="pos-row-toggle" data-toggle-position="${p.id}" aria-label="Підпозиції">${state.expandedPositionIds.has(p.id) ? "▾" : "▸"}</button>`
      : "";

  return `
    <article class="pos-row ${isSub ? "pos-row--sub" : ""}" ${indent} data-position-row="${p.id}">
      <div class="pos-row-top">
        ${toggleBtn}
        <button type="button" class="pos-row-name" data-open-position="${p.id}">
          ${escapeHtml(p.item || "—")}
          ${problem ? '<span class="pos-row-warn" title="Є проблема">!</span>' : ""}
        </button>
        <span class="pos-row-stage">${escapeHtml(currentLabel)}</span>
        <span class="pos-row-pct">${p.progress ?? 0}%</span>
        ${
          showAdvance
            ? `<button type="button" class="pos-row-next" data-quick-advance="${p.id}" data-stage="${p.currentStage}" title="Наступний крок">→</button>`
            : `<span class="pos-row-next-spacer"></span>`
        }
      </div>
      ${renderStepTrack(p, { canEdit })}
    </article>`;
}

function renderInlineAdd(canEdit) {
  if (!canEdit) return "";
  return `
    <form class="order-inline-add" id="orderInlineAddForm">
      <input type="text" id="orderInlineAddInput" placeholder="Назва виробу або зони" autocomplete="off" aria-label="Назва нової позиції" />
      <button type="submit" class="btn btn-primary btn-sm">Додати</button>
    </form>`;
}

function renderPositionsSection(order, allPositions, related) {
  const canEdit = canEditPositions();
  const work = [...getWorkPositions(order, related)].sort((a, b) => {
    const ga = resolvePositionGodmode(a).attentionScore;
    const gb = resolvePositionGodmode(b).attentionScore;
    return gb - ga;
  });
  const rows = work.map((position) => ({
    position,
    depth: 0,
    isSub: false,
    childCount: 0
  }));
  const body = rows.length
    ? rows.map((row) => renderPositionRow(row, { canEdit })).join("")
    : renderSmartEmptyState({
        icon: "📦",
        title: "Позицій ще немає",
        text: canEdit
          ? "Додайте першу позицію нижче — кожен рядок стане окремим виробом у workflow."
          : "Позиції зʼявляться, коли менеджер додасть їх до замовлення."
      });

  return `
    <section class="order-positions card" role="tabpanel">
      <h3 class="order-positions-title enver-section-title">Позиції</h3>
      <div class="order-positions-list">${body}</div>
      ${renderInlineAdd(canEdit)}
    </section>`;
}

function renderPositionTabSection(position, bundle) {
  const subTab = getPositionSubTab(position.id);
  const downstream = state.ordersView.positionTabDownstream?.[position.id] || null;
  return renderPositionOrderTab(position, bundle, { subTab, downstream });
}

function renderHistorySection(order) {
  const entries = (state.history || []).filter(
    (e) =>
      e.orderId === order.id ||
      e.orderNumber === order.orderNumber ||
      (e.entityType === "order" && e.entityId === order.id)
  );

  if (!entries.length) {
    return renderSmartEmptyState({
      icon: "🕐",
      title: "Історія порожня",
      text: "Зміни по цьому замовленню зʼявляться тут автоматично."
    });
  }

  const rows = entries
    .slice(0, 40)
    .map(
      (e) => `
      <article class="order-history-row">
        <time>${escapeHtml(formatHistoryTime(e.createdAt))}</time>
        <span class="enver-badge enver-badge-info">${escapeHtml(e.actionLabel || e.action)}</span>
        <p>${escapeHtml(e.summary || "—")}</p>
        ${renderChangesList(e.changes)}
      </article>`
    )
    .join("");

  return `<section class="order-history card" role="tabpanel"><div class="order-history-list">${rows}</div></section>`;
}

function renderOrderStickyBar(order, allPositions, related, workPositions = null) {
  const gm = resolveOrderGodmode(order, allPositions);
  const next = gm.nextAction;
  if (!next?.label) return "";

  const work = workPositions || getWorkPositions(order, related);
  const focusPosition = work[0] || related.find((p) => !p.parentId) || related[0];
  const isBlocked = gm.health === "blocked" || next.allowed === false;
  const ctaAttrs =
    next.allowed !== false
      ? buildGodmodeCtaAttrs(next, { orderId: order.id, positionId: focusPosition?.id ?? null })
      : "";

  const ctaLabel = next.buttonLabel || "Виконати";
  const ctaBtn =
    next.allowed !== false && ctaAttrs
      ? `<button type="button" class="enver-sticky-bar-cta" ${ctaAttrs}>${escapeHtml(ctaLabel)}</button>`
      : "";

  return `
    <div class="enver-sticky-bar ${isBlocked ? "enver-sticky-bar--blocked" : ""}" role="region" aria-label="Головна дія">
      <div class="enver-sticky-bar-text">
        <span class="enver-sticky-bar-kicker">${isBlocked ? "Потрібна дія" : "Далі"}</span>
        <strong>${escapeHtml(next.label)}</strong>
      </div>
      <div class="enver-sticky-bar-actions">
        ${ctaBtn}
        <button type="button" class="enver-sticky-bar-secondary" data-order-detail-tab="overview">Огляд</button>
      </div>
    </div>`;
}

function renderTabContent(tab, order, allPositions, related, positionBundles = {}) {
  if (tab.startsWith("pos-")) {
    const positionId = Number(tab.slice(4));
    const position = getWorkPositions(order, related).find((p) => p.id === positionId);
    if (!position) {
      return renderSmartEmptyState({ icon: "📦", title: "Позицію не знайдено", text: "" });
    }
    return renderPositionTabSection(position, positionBundles[positionId]);
  }
  switch (tab) {
    case "model-3d":
      return renderOrder3DTab(order, getCachedOrder3DAsset(order.id));
    case "positions":
      return renderPositionsSection(order, allPositions, related);
    case "history":
      return renderHistorySection(order);
    case "overview":
    default:
      return `${renderOrderGodmodeSummary(order, allPositions)}${renderOverviewWorkPositions(order, related)}`;
  }
}

function renderOverviewWorkPositions(order, related) {
  const work = getWorkPositions(order, related);
  if (!work.length) return "";
  const rows = work
    .map(
      (p) => `
      <button type="button" class="order-constructive-row" data-order-detail-tab="pos-${p.id}">
        <div>
          <strong>${escapeHtml(p.item || "—")}</strong>
          <span class="enver-meta">${p.managerDataComplete ? "Дані заповнено" : "Потрібні дані менеджера"}${p.constructivePackageStatus ? ` · ${escapeHtml(p.constructivePackageStatus)}` : p.hasConstructiveFile ? " · конструктив" : ""}</span>
        </div>
        <span class="enver-badge">${p.progress ?? 0}%</span>
      </button>`
    )
    .join("");
  return `<section class="order-overview-positions card">
    <h3 class="enver-section-title">Робочі позиції</h3>
    <div class="order-constructive-list">${rows}</div>
    ${canEditPositions() ? renderInlineAdd(true) : ""}
  </section>`;
}

export function renderOrderDetailView(order, allPositions, related, positionBundles = {}) {
  const tab = state.ordersView.detailTab || "overview";
  const hero = renderOrderHero(order, related, tab);
  const tabs = renderDetailTabs(order, related, tab);
  const panel = renderTabContent(tab, order, allPositions, related, positionBundles);
  const work = getWorkPositions(order, related);
  const stickyBar = renderOrderStickyBar(order, allPositions, related, work);

  return `<div class="orders-view orders-view--detail${stickyBar ? " enver-screen--sticky-mobile" : ""}">${hero}${tabs}<div class="order-detail-panel">${panel}</div>${stickyBar}</div>`;
}
