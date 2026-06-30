import { enrichPositionRow } from "@enver/shared/production/position-logic.js";
import { buildOrderGodmode, buildPositionGodmode } from "@enver/shared/production/godmode.js";
import { STAGE_STATUS_FIELD } from "@enver/shared/production/stages.js";
import {
  getWorkPositions,
  workflowPositionsForOrders
} from "@enver/shared/production/order-position-model.js";
import {
  HANDOFF_ACTION_TYPES,
  ORDER_API_ACTION_TYPES,
  UI_ACTION_TYPES,
  PROCUREMENT_NAV_ACTION_TYPES,
  canQuickRunGodmodeAction,
  orderDetailSubTabForGodmodeAction,
  buildGodmodeCtaAttrs
} from "@enver/shared/production/godmode-ui-helpers.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { aggregateOrderAttention } from "./attention.js";
import { positionsForOrder } from "./workflows.js";
import { canManageConstructorDesk } from "./auth.js";
import { CONSTRUCTOR_DESK_TAB } from "./constants.js";
import { getProcurementSummaryForPosition } from "./procurement-view.js";
import { escapeHtml } from "./utils.js";

const HEALTH_LABELS = {
  ok: "У нормі",
  warning: "Увага",
  blocked: "Заблоковано",
  overdue: "Прострочено"
};

export function resolveOrderGodmode(order, positions = []) {
  const related = positionsForOrder(order, positions);
  return buildOrderGodmode(order, related, { planDate: order.planDate });
}

function isCompletePositionGodmode(gm) {
  return (
    gm &&
    Array.isArray(gm.warnings) &&
    Array.isArray(gm.blockers) &&
    Object.prototype.hasOwnProperty.call(gm, "nextAction")
  );
}

export function resolvePositionGodmode(position) {
  if (isCompletePositionGodmode(position?.godmode)) {
    return patchAssignConstructorAction(position.godmode);
  }
  const summary = getProcurementSummaryForPosition(position.id);
  const gm = buildPositionGodmode(position, {
    planDate: position.planDate,
    hasConstructivePackage: position.hasConstructivePackage,
    packageStatus: position.constructivePackageStatus || null,
    unmappedPartsCount: position.unmappedPartsCount || 0,
    orderHasSubPositions: position.orderHasSubPositions,
    procurementItems: position.procurement?.items,
    openReturns: summary?.openReturns || 0,
    hasProcurementSource: position.hasProcurementSource,
    hasProcurementRequest: position.hasProcurementRequest,
    procurementStatus: position.procurementRequestStatus || position.procurement?.status || null
  });
  return patchAssignConstructorAction(gm);
}

function patchAssignConstructorAction(gm) {
  if (gm?.nextAction?.type !== "assign_constructor") return gm;
  if (canManageConstructorDesk()) return gm;
  return {
    ...gm,
    nextAction: {
      ...gm.nextAction,
      allowed: false,
      reason: "Призначення конструктора виконує начальник виробництва на вкладці «Конструктори».",
      buttonLabel: ""
    }
  };
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

export {
  canQuickRunGodmodeAction,
  canAttentionQuickRun,
  orderDetailSubTabForGodmodeAction,
  panelForGodmodeAction,
  shouldOpenOrderDetailForGodmodeAction,
  PROCUREMENT_NAV_ACTION_TYPES
} from "@enver/shared/production/godmode-ui-helpers.js";

export function renderAutomationHints(godmode) {
  const hints = godmode?.automationHints;
  if (!hints?.length) return "";
  return `<ul class="godmode-automation-hints" aria-label="Підказки автоматизації">
    ${hints
      .map(
        (h) =>
          `<li class="godmode-automation-hint"><span class="godmode-automation-hint-icon" aria-hidden="true">⚡</span>${escapeHtml(h.message || "")}</li>`
      )
      .join("")}
  </ul>`;
}

export function renderNextActionBanner(
  godmode,
  { positionId = null, orderId = null, showCta = true } = {}
) {
  const next = godmode?.nextAction;
  if (!next?.label) return "";

  const isBlocked = godmode?.health === "blocked" || next.allowed === false;
  const ctaAttrs =
    showCta && next.allowed !== false ? buildGodmodeCtaAttrs(next, { positionId, orderId }) : "";

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
  const work = getWorkPositions(order, positions);
  const focusPosition =
    work[0] || positionsForOrder(order, positions).find((p) => !p.parentId) || null;

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
      ${renderAutomationHints(gm)}
      ${renderNextActionBanner(gm, { orderId: order.id, positionId: focusPosition?.id ?? null })}
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

/** Empty state з покроковою інструкцією. */
export function renderInstructionalEmptyState({
  icon = "✨",
  title,
  steps = [],
  actionLabel,
  actionId
}) {
  const stepsHtml = steps.length
    ? `<ol class="enver-empty-steps">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`
    : "";
  return `<div class="enver-empty-state godmode-empty-state enver-empty-state--instructional">
    <span class="enver-empty-state-icon" aria-hidden="true">${icon}</span>
    <h3 class="enver-empty-state-title">${escapeHtml(title)}</h3>
    ${stepsHtml}
    ${actionLabel && actionId ? `<button type="button" class="btn btn-primary" id="${escapeHtml(actionId)}">${escapeHtml(actionLabel)}</button>` : ""}
  </div>`;
}

/** Блоки для production floor з локального state.positions. */
export function buildFloorGodmodeBuckets(positions = []) {
  const workflow = workflowPositionsForOrders([], positions);
  const buckets = {
    attention: [],
    overdue: [],
    awaitingConstructive: [],
    awaitingTasks: [],
    readyForInstall: [],
    problems: [],
    activeOperators: []
  };

  for (const p of workflow) {
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
  const previewLimit = 5;

  const section = (title, items, id) => {
    if (!items.length) return "";
    const preview = items.slice(0, previewLimit);
    const hasMore = items.length > previewLimit;
    const rows = (list) =>
      list
        .map(({ position: p, godmode: gm }) => {
          const nextType = gm.nextAction?.type;
          const quickRun =
            canQuickRunGodmodeAction(nextType) && gm.nextAction?.allowed !== false
              ? `<button type="button" class="pf-godmode-run" title="Виконати"
                  data-pf-run="${p.id}" data-pf-action="${escapeHtml(nextType)}">▶</button>`
              : "";
          return `<div class="pf-godmode-row-wrap">
            <button type="button" class="pf-godmode-row" data-edit-position="${p.id}">
              <strong>${escapeHtml(p.orderNumber)} · ${escapeHtml(p.item || "—")}</strong>
              <span>${escapeHtml(gm.nextAction?.label || "—")}</span>
              ${renderHealthBadge(gm.health)}
            </button>
            ${quickRun}
          </div>`;
        })
        .join("");

    return `<section class="pf-section pf-godmode-group" data-pf-group="${id}">
      <div class="attention-group-head">
        <h2 class="pf-section-title">${escapeHtml(title)} <span class="attention-group-count">${items.length}</span></h2>
        ${hasMore ? `<button type="button" class="attention-show-all" data-pf-expand="${id}">Показати всі</button>` : ""}
      </div>
      ${rows(preview)}
      ${hasMore ? `<div class="pf-godmode-more" data-pf-more="${id}" hidden>${rows(items.slice(previewLimit))}</div>` : ""}
    </section>`;
  };

  return [
    section("Потребує уваги", buckets.attention, "attention"),
    section("Прострочені", buckets.overdue, "overdue"),
    section("Очікують конструктив", buckets.awaitingConstructive, "constructive"),
    section("Очікують задачі", buckets.awaitingTasks, "tasks"),
    section("Готові до монтажу", buckets.readyForInstall, "install"),
    section("Проблеми", buckets.problems, "problems")
  ].join("");
}

export function sortOrdersByAttention(orders, positions = []) {
  return [...orders].sort(
    (a, b) =>
      (resolveOrderGodmode(b, positions).attentionScore || 0) -
      (resolveOrderGodmode(a, positions).attentionScore || 0)
  );
}

export function rootPositionForOrder(order, positions) {
  return positionsForOrder(order, positions).find((p) => !p.parentId);
}

/** Відкриває картку замовлення / стіл конструктора для godmode-дії. */
export function navigateGodmodeAction(position, actionType, appState) {
  if (!position) return false;

  if (actionType === "assign_constructor") {
    if (canManageConstructorDesk() && position.orderId != null) {
      appState.selectedOrderId = position.orderId;
      appState.activeTab = "Замовлення";
      appState.ordersView.detailTab = `pos-${position.id}`;
      appState.ordersView.focusResponsiblesPositionId = position.id;
      return true;
    }
    appState.activeTab = CONSTRUCTOR_DESK_TAB;
    appState.constructorDesk.detail = null;
    appState.constructorDesk.selectedPositionId = null;
    appState.constructorDesk.workspaceTab = "work";
    if (position.orderId != null) {
      appState.constructorDesk.selectedOrderId = position.orderId;
    } else if (position.orderNumber) {
      appState.constructorDesk.selectedOrderId = position.orderNumber;
    }
    return true;
  }

  if (actionType === "upload_constructive" || actionType === "upload_constructive_package") {
    return false;
  }

  const orderId = position.orderId;
  if (!orderId) return false;

  const subTab = orderDetailSubTabForGodmodeAction(actionType);
  if (!subTab && actionType !== "fill_manager_data") return false;

  appState.selectedOrderId = orderId;
  appState.activeTab = "Замовлення";
  appState.ordersView.detailTab = `pos-${position.id}`;
  appState.ordersView.positionSubTab = {
    ...(appState.ordersView.positionSubTab || {}),
    [position.id]: subTab || "manager"
  };
  return true;
}

function applyOptimisticHandoffPatch(position, actionType) {
  const snakeTarget = {
    handoff_to_cutting: "cutting",
    handoff_to_edging: "edging",
    handoff_to_drilling: "drilling",
    handoff_to_assembly: "assembly"
  };
  const target = snakeTarget[actionType];
  const patch = { ...position };
  if (target) {
    const snake = STAGE_STATUS_FIELD[target];
    const camel = `${target}Status`;
    patch[snake] = "Передано";
    patch[camel] = "Передано";
  }
  return enrichPositionRow(patch);
}

async function runOptimisticHandoff(positionId, actionType, deps) {
  const positions = deps.getPositions?.() || [];
  const snapshot = positions.find((p) => p.id === positionId);
  const { showOptimisticUpdate } = await import("./interactions/optimistic-ui.js");

  return showOptimisticUpdate({
    apply: () => {
      if (!snapshot) return;
      deps.upsertPosition?.(applyOptimisticHandoffPatch(snapshot, actionType));
      window.__enverRender?.({ contentOnly: true });
    },
    rollback: () => {
      if (snapshot) deps.upsertPosition?.(snapshot);
    },
    commit: async () => {
      const updated = await deps.api.runPositionNextAction(positionId, actionType);
      deps.upsertPosition?.(updated);
      return updated;
    },
    label: "Етап передано"
  });
}

/** Виконує головну дію замовлення або повертає підказку для UI. */
export async function executePrimaryOrderAction(
  order,
  positions,
  { api, upsertPosition, upsertOrder }
) {
  const gm = resolveOrderGodmode(order, positions);
  const next = gm.nextAction;
  const work = getWorkPositions(order, positions);
  const focusPosition = work[0] || rootPositionForOrder(order, positions) || null;

  if (!next?.type) {
    return { action: "open_order" };
  }

  if (HANDOFF_ACTION_TYPES.has(next.type) && focusPosition?.id && next.allowed !== false) {
    const updated = await runOptimisticHandoff(focusPosition.id, next.type, {
      api,
      upsertPosition,
      getPositions: () => positions
    });
    return { action: "handoff", position: updated, message: next.label };
  }

  if (PROCUREMENT_NAV_ACTION_TYPES.has(next.type) && focusPosition?.id) {
    if (next.type === "create_procurement") {
      const { openGodmodePositionTarget } = await import("./godmode-navigation.js");
      await openGodmodePositionTarget(focusPosition, next.type);
    }
    return {
      action: "open_order",
      tab: `pos-${focusPosition.id}`,
      subTab: "procurement",
      positionId: focusPosition.id
    };
  }

  if (UI_ACTION_TYPES.has(next.type) && focusPosition?.id) {
    if (next.type === "assign_constructor") {
      return { action: "open_constructor_desk", orderId: order.id, positionId: focusPosition.id };
    }
    if (next.type === "upload_constructive" || next.type === "upload_constructive_package") {
      return {
        action: "open_constructor_desk",
        orderId: order.id,
        positionId: focusPosition.id,
        workspaceTab: "package"
      };
    }
    const subTab = orderDetailSubTabForGodmodeAction(next.type);
    if (subTab || next.type === "fill_manager_data") {
      return {
        action: "open_order",
        tab: `pos-${focusPosition.id}`,
        subTab: subTab || "manager",
        positionId: focusPosition.id
      };
    }
    return {
      action: "open_position",
      positionId: focusPosition.id,
      panel: next.type === "schedule_install" ? "install" : "more",
      focus: next.type
    };
  }

  if (ORDER_API_ACTION_TYPES.has(next.type) && next.allowed !== false) {
    const updated = await api.runOrderNextAction(order.id, next.type);
    if (upsertOrder) upsertOrder(updated);
    return { action: "close_order", order: updated, message: next.label || "Замовлення закрито" };
  }

  if (next.type === "add_position") {
    return { action: "open_order", hint: "add_position", tab: "positions" };
  }

  return { action: "open_order", nextAction: next };
}

/** Залежності для виконання godmode-дій з UI. */
export async function buildGodmodeActionDeps(overrides = {}) {
  const { api } = await import("./api.js");
  const { upsertPosition, upsertOrder, refreshAppData } = await import("./data-sync.js");
  const { openPositionEditDrawer } = await import("./positions.js");
  const { toastSuccess, toastError } = await import("./toast.js");
  const { humanizeUserMessage } = await import("./utils.js");
  const { state } = await import("./state.js");

  return {
    api,
    upsertPosition,
    upsertOrder,
    refreshAppData,
    openPositionEditDrawer,
    toastSuccess,
    toastError,
    humanizeUserMessage,
    openOrderDetail: (orderId, tab = "overview", subTab = null) => {
      state.selectedOrderId = orderId;
      state.ordersView.detailTab = tab;
      if (tab.startsWith("pos-") && subTab) {
        const positionId = Number(tab.slice(4));
        if (Number.isFinite(positionId)) {
          state.ordersView.positionSubTab = {
            ...(state.ordersView.positionSubTab || {}),
            [positionId]: subTab
          };
        }
      }
      state.activeTab = "Замовлення";
      window.__enverRender?.();
      window.scrollTo?.({ top: 0, behavior: "instant" });
    },
    getPositions: () => state.positions,
    getOrders: () => state.orders,
    ...overrides
  };
}

/** Виконує дію зі сповіщення або вкладки «Потребує уваги». */
export async function executeGodmodeAction({ entityType, entityId, actionType }, depsIn) {
  const deps = depsIn || (await buildGodmodeActionDeps());
  const positions = deps.getPositions?.() || [];
  const orders = deps.getOrders?.() || [];

  try {
    if (actionType === "open_order" && entityType === "order") {
      deps.openOrderDetail?.(Number(entityId));
      return { action: "open_order" };
    }

    if (actionType === "add_position" && entityType === "order") {
      deps.openOrderDetail?.(Number(entityId), "positions");
      const { focusOrderInlineAddInput } = await import("./order-detail.js");
      focusOrderInlineAddInput();
      return { action: "open_order", tab: "positions" };
    }

    if (actionType === "close_order" || entityType === "order") {
      const order = orders.find((o) => o.id === Number(entityId));
      if (!order) throw new Error("Замовлення не знайдено");
      const result = await executePrimaryOrderAction(order, positions, deps);
      if (result.action === "open_constructor_desk") {
        const { openConstructorDeskForAssignment, openConstructorWorkspace } =
          await import("./constructor-desk.js");
        if (result.workspaceTab === "package" && result.positionId) {
          await openConstructorWorkspace(result.positionId, { workspaceTab: "package" });
        } else {
          await openConstructorDeskForAssignment({
            orderId: result.orderId,
            positionId: result.positionId
          });
        }
        return result;
      }
      if (result.action === "close_order" || result.action === "handoff") {
        deps.toastSuccess?.(result.message || "Готово");
        await deps.refreshAppData?.({ includeDirectories: false, syncViews: true });
        window.__enverRender?.({ contentOnly: true });
      } else if (result.action === "open_position") {
        const position = deps.getPositions?.().find((p) => p.id === result.positionId);
        if (position) deps.openPositionEditDrawer?.(position, { panel: result.panel });
      } else {
        deps.openOrderDetail?.(order.id, result.tab || "overview");
        if (result.hint === "add_position" || result.tab === "positions") {
          const { focusOrderInlineAddInput } = await import("./order-detail.js");
          focusOrderInlineAddInput();
        }
      }
      return result;
    }

    const positionId = Number(entityId);
    let position = positions.find((p) => p.id === positionId);
    if (!position && deps.api?.getPosition) {
      position = await deps.api.getPosition(positionId);
      deps.upsertPosition?.(position);
    }
    if (!position) throw new Error("Позицію не знайдено");

    const effectiveAction = actionType || position.godmode?.nextAction?.type;

    if (effectiveAction && HANDOFF_ACTION_TYPES.has(effectiveAction)) {
      await runOptimisticHandoff(positionId, effectiveAction, deps);
      deps.toastSuccess?.("Дію виконано");
      await deps.refreshAppData?.({ includeDirectories: false, syncViews: true });
      window.__enverRender?.({ contentOnly: true });
      return { action: "handoff" };
    }

    if (effectiveAction === "create_tasks_from_ai") {
      await deps.api?.createTasksFromAi?.(positionId, { mode: "assisted" });
      deps.toastSuccess?.("Задачі створено з рекомендацій ШІ");
      await deps.refreshAppData?.({ includeDirectories: false, syncViews: true });
      window.__enverRender?.({ contentOnly: true });
      return { action: "create_tasks_from_ai" };
    }

    const { openPositionFromContext } = await import("./godmode-navigation.js");
    await openPositionFromContext(positionId, effectiveAction);
    window.__enverRender?.();
    window.scrollTo?.({ top: 0, behavior: "instant" });
    return { action: "open_position" };
  } catch (err) {
    deps.toastError?.(deps.humanizeUserMessage?.(err?.message) || err?.message || "Помилка");
    throw err;
  }
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

/** Кнопки godmode «В закупівлю» / «Відкрити закупівлю» у банері позиції. */
export function bindGodmodeNavCta(root, { onRefresh } = {}) {
  if (!root) return;
  root.querySelectorAll("[data-godmode-nav]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const actionType = btn.dataset.godmodeNav;
      const positionId = Number(btn.dataset.godmodeNavPosition);
      if (!actionType || !positionId) return;
      const position = (await import("./state.js")).state.positions.find(
        (p) => p.id === positionId
      );
      if (!position) return;
      const { openGodmodePositionTarget } = await import("./godmode-navigation.js");
      const { state } = await import("./state.js");
      if (position.orderId != null) {
        state.selectedOrderId = position.orderId;
        state.activeTab = "Замовлення";
        state.ordersView.detailTab = `pos-${positionId}`;
        state.ordersView.positionSubTab = {
          ...(state.ordersView.positionSubTab || {}),
          [positionId]: "procurement"
        };
      }
      await openGodmodePositionTarget(position, actionType);
      onRefresh?.({ contentOnly: false });
    });
  });
}
