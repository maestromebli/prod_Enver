import { PIPELINE_STAGES, STAGE_STATUS_DONE, stageLabel } from "@enver/shared/production/stages.js";
import { constructiveFilesSummary } from "@enver/shared/production/constructive-files.js";
import {
  getWorkPositions,
  getPositionTabLabel
} from "@enver/shared/production/order-position-model.js";
import { api } from "./api.js";
import { canEditOrders, canEditPositions } from "./auth.js";
import {
  buildVisiblePositionRows,
  expandPosition,
  togglePositionExpanded
} from "./position-tree.js";
import { quickAdvancePosition } from "./positions.js";
import { runSave } from "./save-flow.js";
import { state } from "./state.js";
import { badge, escapeHtml, progressRing } from "./utils.js";
import {
  navigateGodmodeAction,
  renderNextActionBanner,
  renderOrderGodmodeSummary,
  renderSmartEmptyState,
  resolveOrderGodmode,
  resolvePositionGodmode
} from "./godmode-ui.js";
import {
  HANDOFF_ACTION_TYPES,
  UI_ACTION_TYPES,
  buildGodmodeCtaAttrs
} from "@enver/shared/production/godmode-ui-helpers.js";
import { formatHistoryTime, renderChangesList } from "./history.js";
import { STAGES, getStageStatus } from "./workflows.js";
import { loadPositionManagerBundle } from "./position-manager-panel.js";
import {
  clearAllPositionOrderTabCache,
  bindPositionOrderTab,
  getPositionSubTab,
  loadPositionOrderTabData,
  renderPositionOrderTab
} from "./position-order-tab.js";

function buildDetailTabs(order, related, activeTab) {
  const work = getWorkPositions(order, related);
  const tabs = [{ key: "overview", label: "Огляд" }];
  work.forEach((p, i) => {
    tabs.push({ key: `pos-${p.id}`, label: getPositionTabLabel(p, i) });
  });
  tabs.push({ key: "history", label: "Історія" });
  const buttons = tabs
    .map(
      (t) =>
        `<button type="button" class="enver-segmented-btn ${activeTab === t.key ? "active" : ""}" data-order-detail-tab="${t.key}" role="tab" aria-selected="${activeTab === t.key}">${escapeHtml(t.label)}</button>`
    )
    .join("");
  return `<nav class="enver-segmented order-detail-tabs" role="tablist" aria-label="Розділи замовлення">${buttons}</nav>`;
}

function orderProgress(order, related) {
  const work = getWorkPositions(order, related);
  if (!work.length) return 0;
  const sum = work.reduce((acc, p) => acc + (p.progress ?? 0), 0);
  return Math.round(sum / work.length);
}

function metaLine(parts) {
  const items = parts.filter(Boolean);
  return items.length ? `<p class="order-hero-meta">${items.join(" · ")}</p>` : "";
}

function renderOrderHero(order, related) {
  const work = getWorkPositions(order, related);
  const progress = orderProgress(order, related);
  const canEdit = canEditOrders();
  const extras = [
    order.manager ? `Менеджер: ${escapeHtml(order.manager)}` : "",
    order.planDate ? `План ${escapeHtml(order.planDate)}` : "",
    order.startDate ? `Запуск ${escapeHtml(order.startDate)}` : "",
    order.priority && order.priority !== "Звичайний" ? escapeHtml(order.priority) : ""
  ].filter(Boolean);

  return `
    <header class="order-hero card">
      <button type="button" class="order-hero-back" data-orders-back>← Замовлення</button>
      <div class="order-hero-main">
        <div class="order-hero-text">
          <h2 class="order-hero-title enver-page-title">${escapeHtml(order.orderNumber)}</h2>
          <p class="order-hero-object">${escapeHtml(order.object || "—")}</p>
          ${order.client ? `<p class="order-hero-client enver-meta">${escapeHtml(order.client)}</p>` : ""}
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
  const sortedRelated = [...related].sort((a, b) => {
    const ga = resolvePositionGodmode(a).attentionScore;
    const gb = resolvePositionGodmode(b).attentionScore;
    return gb - ga;
  });
  const rows = buildVisiblePositionRows(allPositions, sortedRelated, state.expandedPositionIds);
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

function renderConstructiveSection(order, related) {
  const work = getWorkPositions(order, related);
  if (!work.length) {
    return renderSmartEmptyState({
      icon: "📐",
      title: "Немає позицій",
      text: "Спочатку додайте позицію до замовлення."
    });
  }

  const rows = work
    .map((p) => {
      const ok = p.hasConstructiveFile;
      const statusClass = ok ? "enver-badge-success" : "enver-badge-warning";
      const statusText = ok ? "Завантажено" : "Потрібен файл";
      const meta = ok
        ? escapeHtml(
            constructiveFilesSummary({
              fileCount: p.constructiveFileCount,
              latestName: p.constructiveFileName
            }) || "файл"
          )
        : "PDF, ZIP, XML, DWG, XLS, B3D";
      return `
        <button type="button" class="order-constructive-row" data-open-position="${p.id}">
          <div>
            <strong>${escapeHtml(p.item || "—")}</strong>
            <span class="enver-meta">${meta}</span>
          </div>
          <span class="enver-badge ${statusClass}">${statusText}</span>
        </button>`;
    })
    .join("");

  return `<section class="order-constructive card" role="tabpanel"><div class="order-constructive-list">${rows}</div></section>`;
}

function renderInstallSection(order, related) {
  const installDate = order.installDate || order.install_date;
  const roots = related.filter((p) => !p.parentId);
  const readyCount = roots.filter((p) => {
    const s = p.positionStatus || p.position_status || "";
    return s.includes("встановлення") || s.includes("монтаж") || (p.progress ?? 0) >= 100;
  }).length;

  return `
    <section class="order-install card" role="tabpanel">
      <div class="order-install-summary">
        <div class="order-install-stat">
          <span class="enver-kpi-value">${readyCount}</span>
          <span class="enver-kpi-label">Готово до монтажу</span>
        </div>
        <div class="order-install-stat">
          <span class="enver-kpi-value">${installDate ? escapeHtml(installDate) : "—"}</span>
          <span class="enver-kpi-label">Дата монтажу</span>
        </div>
      </div>
      ${
        !installDate && readyCount > 0
          ? `<p class="order-install-hint">Позиції готові — можна запланувати монтаж на вкладці «Встановлення».</p>`
          : !installDate
            ? `<p class="order-install-hint enver-meta">Монтаж можна запланувати після завершення пакування.</p>`
            : ""
      }
      ${
        roots.length
          ? `<ul class="order-install-positions">${roots
              .map(
                (p) =>
                  `<li><strong>${escapeHtml(p.item || "—")}</strong> — ${escapeHtml(p.positionStatus || "—")} (${p.progress ?? 0}%)</li>`
              )
              .join("")}</ul>`
          : ""
      }
    </section>`;
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

function renderNextActionBannerSection(related) {
  const root = related.find((p) => !p.parentId) || related[0];
  if (!root) return "";
  const gm = resolvePositionGodmode(root);
  return renderNextActionBanner(gm, { positionId: root.id });
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
  const hero = renderOrderHero(order, related);
  const tabs = renderDetailTabs(order, related, tab);
  const panel = renderTabContent(tab, order, allPositions, related, positionBundles);
  const work = getWorkPositions(order, related);
  const stickyBar = renderOrderStickyBar(order, allPositions, related, work);

  return `<div class="orders-view orders-view--detail${stickyBar ? " enver-screen--sticky-mobile" : ""}">${hero}${tabs}<div class="order-detail-panel">${panel}</div>${stickyBar}</div>`;
}

async function patchPositionStage(positionId, stageKey, payload, onRefresh) {
  const stage = STAGES.find((s) => s.key === stageKey);
  const stageName = stage?.label || stageKey;

  await runSave(`Етап «${stageName}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(positionId, stageKey, payload);
      const idx = state.positions.findIndex((p) => p.id === positionId);
      if (idx >= 0) state.positions[idx] = updated;
      return updated;
    },
    successMessage: `«${stageName}»: ${payload.status}`,
    onSuccess: async () => {
      await onRefresh?.();
    }
  }).catch(() => {});
}

async function movePositionToStage(position, targetStageKey, onRefresh) {
  const stage = STAGES.find((s) => s.key === targetStageKey);
  if (!stage) return;

  if (stage.type === "constructor") {
    if (!position.hasConstructiveFile) {
      const { toastError } = await import("./toast.js");
      toastError("Спочатку завантажте конструктив у позиції");
      return;
    }
    await patchPositionStage(
      position.id,
      targetStageKey,
      stagePatchPayload(position, stage, "Передано"),
      onRefresh
    );
    return;
  }

  await patchPositionStage(
    position.id,
    targetStageKey,
    stagePatchPayload(position, stage, "В роботі"),
    onRefresh
  );
}

function stagePatchPayload(position, stage, status) {
  if (stage.type === "constructor") {
    return { status, constructor: position.constructor };
  }
  return { status, assemblyResponsible: position.assemblyResponsible };
}

function rootForOrder(order, related) {
  return related.find((p) => !p.parentId);
}

export function focusOrderInlineAddInput() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#orderInlineAddInput")?.focus();
    });
  });
}

/** Скидає кеш вкладок картки замовлення при виході або зміні замовлення. */
export function clearOrderDetailViewState() {
  clearAllPositionOrderTabCache();
  state.ordersView.positionBundles = {};
  state.ordersView.positionTabDownstream = {};
  state.ordersView.positionSubTab = {};
  state.ordersView.detailTab = "overview";
}

/** Відкриває позицію у вкладці картки замовлення (новий UI, не drawer). */
export function openPositionInOrderDetail(positionId, subTab = "manager") {
  const id = Number(positionId);
  if (!Number.isFinite(id)) return false;
  const position = state.positions.find((p) => p.id === id);
  const orderId = position?.orderId ?? state.selectedOrderId;
  if (!orderId) return false;

  state.selectedOrderId = orderId;
  state.activeTab = "Замовлення";
  state.ordersView.detailTab = `pos-${id}`;
  if (subTab) {
    state.ordersView.positionSubTab = {
      ...(state.ordersView.positionSubTab || {}),
      [id]: subTab
    };
  }
  return true;
}

async function inlineAddPosition(order, itemName, related, onRefresh) {
  const name = itemName.trim();
  if (!name) return;

  const root = rootForOrder(order, related);
  const body = {
    item: name,
    orderNumber: order.orderNumber,
    orderId: order.id,
    object: order.object,
    manager: order.manager,
    itemType: "Зона"
  };

  if (root) {
    body.parentId = root.id;
  }

  await runSave("Позиція", {
    saveFn: async () => {
      const created = await api.createPosition(body);
      const { upsertPosition } = await import("./data-sync.js");
      upsertPosition(created);
      if (created.parentId) expandPosition(created.parentId);
      return created;
    },
    successMessage: `«${name}» додано`,
    onSuccess: async () => {
      await onRefresh?.();
    }
  }).catch(() => {});
}

function bindStepTrack(root, onRefresh) {
  root.querySelectorAll("[data-step-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.positionId);
      const targetStageKey = btn.dataset.stepJump;
      const position = state.positions.find((p) => p.id === positionId);
      if (!position || position.currentStage === targetStageKey) return;
      await movePositionToStage(position, targetStageKey, onRefresh);
    });
  });
}

function bindQuickAdvance(root, onRefresh) {
  root.querySelectorAll("[data-quick-advance]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.quickAdvance);
      const stageKey = btn.dataset.stage;
      await quickAdvancePosition(id, stageKey);
      await onRefresh?.();
    });
  });
}

export function bindOrderDetail(root, handlers = {}) {
  const { onBack, onRefresh, onOpenPosition, onEditOrder } = handlers;

  root.querySelector("[data-orders-back]")?.addEventListener("click", onBack);

  root.querySelectorAll("[data-order-detail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ordersView.detailTab = btn.dataset.orderDetailTab;
      const tabKey = btn.dataset.orderDetailTab || "";
      if (btn.dataset.posSubJump && tabKey.startsWith("pos-")) {
        const positionId = Number(tabKey.slice(4));
        state.ordersView.positionSubTab = {
          ...(state.ordersView.positionSubTab || {}),
          [positionId]: btn.dataset.posSubJump
        };
      }
      onRefresh?.({ contentOnly: false });
      if (btn.dataset.focusInlineAdd) focusOrderInlineAddInput();
    });
  });

  root.querySelectorAll("[data-open-constructor-desk-order]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
      await openConstructorDeskForAssignment({
        orderId: Number(btn.dataset.openConstructorDeskOrder)
      });
    });
  });

  root.querySelectorAll("[data-open-constructor-desk-position]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.openConstructorDeskPosition);
      const wsTab = btn.dataset.constructorWsTab === "package" ? "package" : "work";
      if (wsTab === "package") {
        const { openConstructorWorkspace } = await import("./constructor-desk.js");
        await openConstructorWorkspace(positionId, { workspaceTab: "package" });
        return;
      }
      const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
      await openConstructorDeskForAssignment({ positionId });
    });
  });

  root.querySelector("[data-open-constructor-desk]")?.addEventListener("click", async () => {
    const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
    await openConstructorDeskForAssignment({ orderId: state.selectedOrderId });
  });

  const tab = state.ordersView.detailTab || "";
  if (tab.startsWith("pos-")) {
    const positionId = Number(tab.slice(4));
    const position =
      getWorkPositions(
        state.orders.find((o) => o.id === state.selectedOrderId) || {},
        state.positions.filter(
          (p) =>
            p.orderId === state.selectedOrderId ||
            p.orderNumber === state.orders.find((o) => o.id === state.selectedOrderId)?.orderNumber
        )
      ).find((p) => p.id === positionId) || state.positions.find((p) => p.id === positionId);
    const subTab = getPositionSubTab(positionId);

    const bindTab = () => {
      const panel = root.querySelector(`[data-position-tab="${positionId}"]`) || root;
      if (!position) return;
      bindPositionOrderTab(panel, position, state.ordersView.positionBundles?.[positionId], {
        subTab,
        onRefresh,
        onOpenConstructor: async () => {
          const { openConstructorWorkspace } = await import("./constructor-desk.js");
          await openConstructorWorkspace(positionId);
        },
        onOpenPosition: (pid) => onOpenPosition?.(pid)
      });
    };

    const ensureDownstream = () => {
      if (subTab === "manager") {
        bindTab();
        return;
      }
      loadPositionOrderTabData(positionId, subTab)
        .then((data) => {
          state.ordersView.positionTabDownstream = {
            ...(state.ordersView.positionTabDownstream || {}),
            [positionId]: data
          };
          bindTab();
          onRefresh?.({ contentOnly: true });
        })
        .catch(() => bindTab());
    };

    if (!state.ordersView.positionBundles?.[positionId]) {
      loadPositionManagerBundle(positionId)
        .then((bundle) => {
          state.ordersView.positionBundles = {
            ...(state.ordersView.positionBundles || {}),
            [positionId]: bundle
          };
          ensureDownstream();
        })
        .catch(() => ensureDownstream());
    } else {
      ensureDownstream();
    }
  }

  root.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => onEditOrder?.(Number(btn.dataset.editOrder)));
  });

  root.querySelectorAll("[data-open-position]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.openPosition);
      if (openPositionInOrderDetail(id)) {
        onRefresh?.({ contentOnly: false });
      } else {
        onOpenPosition?.(id);
      }
    });
  });

  root.querySelectorAll("[data-open-position-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => onOpenPosition?.(Number(btn.dataset.openPositionDrawer)));
  });

  root.querySelectorAll("[data-toggle-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePositionExpanded(Number(btn.dataset.togglePosition));
      onRefresh?.({ contentOnly: true });
    });
  });

  const refresh = () => onRefresh?.({ contentOnly: true });
  bindStepTrack(root, refresh);
  bindQuickAdvance(root, refresh);

  root.querySelectorAll("[data-run-next-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.runNextAction);
      const actionType = btn.dataset.actionType;
      const position = state.positions.find((p) => p.id === positionId);

      if (position && !HANDOFF_ACTION_TYPES.has(actionType)) {
        if (actionType === "assign_constructor") {
          const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
          await openConstructorDeskForAssignment({ positionId });
          return;
        }
        if (navigateGodmodeAction(position, actionType, state)) {
          await onRefresh?.({ contentOnly: false });
          return;
        }
        if (UI_ACTION_TYPES.has(actionType)) {
          onOpenPosition?.(positionId);
          return;
        }
      }

      await runSave("Наступна дія", {
        saveFn: () => api.runPositionNextAction(positionId, actionType),
        successMessage: "Дію виконано",
        onSuccess: async (updated) => {
          const idx = state.positions.findIndex((p) => p.id === positionId);
          if (idx >= 0) state.positions[idx] = updated;
          await onRefresh?.();
        }
      }).catch(() => {});
    });
  });

  root.querySelectorAll("[data-run-order-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = Number(btn.dataset.runOrderAction);
      const actionType = btn.dataset.actionType;
      await runSave("Замовлення", {
        saveFn: () => api.runOrderNextAction(orderId, actionType),
        successMessage: "Замовлення закрито",
        onSuccess: async (updated) => {
          const { upsertOrder, refreshAppData } = await import("./data-sync.js");
          upsertOrder(updated);
          try {
            await refreshAppData({ includeDirectories: false });
          } catch {
            /* локальний стан уже оновлено */
          }
          await onRefresh?.();
        }
      }).catch(() => {});
    });
  });

  const inlineForm = root.querySelector("#orderInlineAddForm");
  const inlineInput = root.querySelector("#orderInlineAddInput");
  inlineForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (!order) return;
    const related = state.positions.filter(
      (p) => p.orderId === order.id || p.orderNumber === order.orderNumber
    );
    const name = inlineInput?.value || "";
    await inlineAddPosition(order, name, related, onRefresh);
    if (inlineInput) inlineInput.value = "";
  });
}
