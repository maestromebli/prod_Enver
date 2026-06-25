import { stageLabel } from "@enver/shared/production/stages.js";
import {
  orderAttentionFromGodmode,
  renderHealthBadge,
  renderAttentionBadge,
  sortOrdersByAttention
} from "./godmode-ui.js";
import { createSwipeActions } from "./interactions/gestures.js";
import { openOrderDetailDrawer, shouldUseOrderDrawer } from "./order-detail-drawer.js";
import { buildVisiblePositionRows, togglePositionExpanded } from "./position-tree.js";
import { positionsForOrder } from "./workflows.js";
import { state } from "./state.js";
import { escapeHtml, progressRing, badge } from "./utils.js";
import { notifyUiChanged } from "./ui-persistence.js";

const DISPLAY_LABELS = { cards: "Картки", list: "Список" };

function toggleOrderExpanded(orderId) {
  const id = Number(orderId);
  if (state.expandedOrderIds.has(id)) {
    state.expandedOrderIds.delete(id);
  } else {
    state.expandedOrderIds.add(id);
  }
}

function orderPositionsToggleBtn(order, related, expanded) {
  const label = expanded ? "Згорнути позиції" : "Показати позиції";
  const icon = expanded ? "−" : "+";
  const countHint = related.length ? ` (${related.filter((p) => !p.parentId).length})` : "";
  return `<button type="button" class="btn-tree btn-order-pos-toggle" data-toggle-order-positions="${order.id}" title="${label}${countHint}" aria-label="${label}" aria-expanded="${expanded}">${icon}</button>`;
}

function renderOrderPositionsInline(order, allPositions) {
  const related = positionsForOrder(order, allPositions);
  if (!related.length) {
    return '<p class="orders-inline-pos-empty enver-meta">Позицій ще немає</p>';
  }

  const rows = buildVisiblePositionRows(allPositions, related, state.expandedPositionIds);
  return rows
    .map((row) => {
      const { position: p, depth, isSub, childCount } = row;
      const expanded = state.expandedPositionIds.has(p.id);
      const subToggle =
        !isSub && childCount > 0
          ? `<button type="button" class="btn-tree" data-toggle-position="${p.id}" title="${expanded ? "Згорнути" : "Підпозиції"}">${expanded ? "▼" : "▶"}</button>`
          : '<span class="btn-tree-spacer" aria-hidden="true"></span>';
      const stage = p.currentStage ? stageLabel(p.currentStage) : "—";
      const subClass = depth > 0 ? " orders-inline-pos--sub" : "";

      return `<div class="orders-inline-pos${subClass}">
        ${subToggle}
        <button type="button" class="orders-inline-pos-name" data-open-position="${p.id}">${escapeHtml(p.item || "—")}</button>
        <span class="orders-inline-pos-stage stage-pill stage-pill--compact">${escapeHtml(stage)}</span>
        <span class="orders-inline-pos-pct">${p.progress ?? 0}%</span>
      </div>`;
    })
    .join("");
}

function orderPositionsPanelHtml(order, allPositions, expanded) {
  if (!expanded) return "";
  return `<div class="order-card-positions" data-order-positions-panel="${order.id}">
    <div class="orders-inline-pos-list">${renderOrderPositionsInline(order, allPositions)}</div>
  </div>`;
}

function orderListPositionsRow(order, allPositions, expanded, colspan) {
  if (!expanded) return "";
  return `<tr class="orders-list-positions-row" data-order-positions-for="${order.id}">
    <td colspan="${colspan}">
      <div class="orders-inline-pos-list">${renderOrderPositionsInline(order, allPositions)}</div>
    </td>
  </tr>`;
}

function priorityClass(priority) {
  const p = String(priority || "").toLowerCase();
  if (p.includes("висок")) return "priority-dot--high";
  if (p.includes("низ")) return "priority-dot--low";
  return "";
}

function mainPositionForOrder(order, rootPositions) {
  return rootPositions.find((p) => p.orderId === order.id || p.orderNumber === order.orderNumber);
}

function ordersModeBarHtml() {
  const mode = state.ordersView.displayMode || "cards";
  const buttons = Object.entries(DISPLAY_LABELS)
    .map(
      ([key, label]) =>
        `<button type="button" class="orders-mode-btn ${mode === key ? "active" : ""}" data-orders-mode="${key}">${label}</button>`
    )
    .join("");
  return `<div class="orders-mode-bar card"><div class="orders-mode-switch">${buttons}</div></div>`;
}

function orderCardBadges(attn) {
  const parts = [];
  if (attn.hasProblem)
    parts.push('<span class="order-attn-badge order-attn-badge--problem">Проблема</span>');
  if (attn.maxOverdue > 0) {
    parts.push(
      `<span class="order-attn-badge order-attn-badge--overdue">+${attn.maxOverdue} д</span>`
    );
  }
  if (attn.needsAssignment) {
    parts.push(
      '<span class="order-attn-badge order-attn-badge--assignment">Немає призначення</span>'
    );
  }
  if (!parts.length) return "";
  return `<div class="order-card-badges">${parts.join("")}</div>`;
}

function progressBarHtml(value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="enver-progress order-card-progress enver-status-animate" aria-label="${v}% готово">
    <div class="enver-progress-track"><div class="enver-progress-fill" style="width:${v}%"></div></div>
    <span class="enver-progress-label">${v}%</span>
  </div>`;
}

function statusPill(order, attn) {
  const status = order.status || "";
  if (status.includes("встановлення") || status.includes("монтаж")) {
    return '<span class="order-card-status-pill">Готово до монтажу</span>';
  }
  if (attn.maxOverdue > 0) {
    return `<span class="order-card-status-pill" style="background:var(--enver-warning-soft);color:var(--enver-warning)">Прострочено</span>`;
  }
  if (attn.hasProblem) {
    return '<span class="order-card-status-pill" style="background:var(--enver-danger-soft);color:var(--enver-danger)">Проблема</span>';
  }
  return `<span class="order-card-status-pill">${escapeHtml(status || "Активний")}</span>`;
}

function orderCardClass(attn, order) {
  const classes = [];
  if (attn.hasProblem || attn.blockers.some((b) => b.severity === "critical")) {
    classes.push("order-card--critical");
  } else if (attn.attentionCount > 0 || attn.needsAssignment) {
    classes.push("order-card--attention");
  }
  if (attn.maxOverdue > 0) classes.push("order-card--overdue");
  const status = order.status || "";
  if (status.includes("встановлення") || status.includes("монтаж")) {
    classes.push("order-card--ready-install");
  }
  return classes.join(" ");
}

function orderCardWarnings(attn) {
  const count = attn.blockers.length + attn.warnings.length;
  if (!count) return "";
  const label = count === 1 ? "1 попередження" : `${count} попередження`;
  return `<p class="order-card-warnings" aria-label="${label}">⚠ ${label}</p>`;
}

function orderCardActions(order, attn) {
  const ctaLabel = attn.nextAction?.label || "Деталі";
  const hasCta = Boolean(attn.nextAction?.label);
  return `<div class="order-card-actions">
    ${hasCta ? `<button type="button" class="order-card-cta enver-pressable" data-order-cta="${order.id}">${escapeHtml(ctaLabel)}</button>` : ""}
    <button type="button" class="order-card-cta order-card-cta--secondary enver-pressable" data-order-detail="${order.id}">Деталі</button>
  </div>`;
}

function ordersEmptyHtml(filtersActive = false) {
  if (filtersActive) {
    return `<div class="enver-empty-state orders-empty">
      <span class="enver-empty-state-icon" aria-hidden="true">🔍</span>
      <h3 class="enver-empty-state-title">Нічого не знайдено</h3>
      <p class="enver-empty-state-text">Немає замовлень за обраними фільтрами. Скиньте фільтри або змініть пошук.</p>
    </div>`;
  }
  return `<div class="enver-empty-state orders-empty">
    <span class="enver-empty-state-icon" aria-hidden="true">📋</span>
    <h3 class="enver-empty-state-title">Поки немає замовлень</h3>
    <p class="enver-empty-state-text">Створіть перше замовлення, щоб запустити виробничий workflow.</p>
  </div>`;
}

function renderOrdersCards(orders, rootPositions, allPositions, filtersActive = false) {
  const cards = orders
    .map((order) => {
      const main = mainPositionForOrder(order, rootPositions);
      const progress = main?.progress ?? 0;
      const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
      const attn = orderAttentionFromGodmode(order, allPositions);
      const gm = attn.godmode;
      const cardClass = orderCardClass(attn, order);
      const posCount = positionsForOrder(order, allPositions).filter((p) => !p.parentId).length;
      const nextLabel = attn.nextAction?.label;
      const swipeRightLabel = nextLabel ? escapeHtml(nextLabel.slice(0, 24)) : "Дія";
      const healthBadge = gm ? renderHealthBadge(gm.health) : "";
      const attentionBadge = gm ? renderAttentionBadge(gm.attentionScore) : "";
      const nextLine = nextLabel
        ? `<p class="order-card-stage-line">Далі: <strong>${escapeHtml(nextLabel)}</strong></p>`
        : "";

      return `
        <article class="order-card enver-interactive enver-pressable enver-swipe-host ${cardClass}" data-order-card="${order.id}" tabindex="0">
          <div class="enver-swipe-reveal" aria-hidden="true">
            <span class="enver-swipe-action enver-swipe-action--right">${swipeRightLabel}</span>
            <span class="enver-swipe-action enver-swipe-action--left">Деталі</span>
          </div>
          <div class="enver-swipe-inner">
          <div class="order-card-status-row">
            <h3 class="order-card-title enver-card-title">${escapeHtml(order.orderNumber)}</h3>
            ${healthBadge}${attentionBadge}${statusPill(order, attn)}
          </div>
          <p class="order-card-meta order-card-object">${escapeHtml(order.object || "—")}</p>
          ${order.client ? `<p class="order-card-meta enver-meta">${escapeHtml(order.client)}</p>` : ""}
          ${progressBarHtml(progress)}
          <p class="order-card-stage-line">Зараз: <strong>${escapeHtml(stage)}</strong></p>
          ${nextLine}
          ${orderCardBadges(attn)}
          ${orderCardWarnings(attn)}
          <div class="order-card-foot">
            ${badge(order.status || "—")}
            ${posCount ? `<span class="order-card-plan">${posCount} поз.</span>` : ""}
            ${order.planDate ? `<span class="order-card-plan">${escapeHtml(order.planDate)}</span>` : ""}
            ${orderPositionsToggleBtn(order, positionsForOrder(order, allPositions), state.expandedOrderIds.has(order.id))}
          </div>
          ${orderPositionsPanelHtml(order, allPositions, state.expandedOrderIds.has(order.id))}
          ${orderCardActions(order, attn)}
          </div>
        </article>`;
    })
    .join("");

  return `<div class="orders-grid">${cards || ordersEmptyHtml(filtersActive)}</div>`;
}

function renderOrdersList(orders, rootPositions, allPositions, filtersActive = false) {
  const colspan = 10;
  const rows = orders.length
    ? orders
        .flatMap((order) => {
          const main = mainPositionForOrder(order, rootPositions);
          const progress = main?.progress ?? 0;
          const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
          const priClass = priorityClass(order.priority);
          const attn = orderAttentionFromGodmode(order, allPositions);
          const rowClass = attn.attentionCount > 0 ? "orders-list-row--attention" : "";
          const related = positionsForOrder(order, allPositions);
          const expanded = state.expandedOrderIds.has(order.id);

          const mainRow = `<tr class="orders-list-row row-clickable ${rowClass}" data-order-list-row="${order.id}" tabindex="0">
            <td class="orders-list-expand">${orderPositionsToggleBtn(order, related, expanded)}</td>
            <td><strong>${escapeHtml(order.orderNumber || "—")}</strong></td>
            <td class="left">${escapeHtml(order.client || "—")}</td>
            <td class="left">${escapeHtml(order.object || "—")}</td>
            <td>${escapeHtml(order.manager || "—")}</td>
            <td><span class="stage-pill stage-pill--compact">${escapeHtml(stage)}</span></td>
            <td>${badge(order.status || "—")}</td>
            <td>${progress}%</td>
            <td>${escapeHtml(order.planDate || "—")}</td>
            <td>${priClass ? `<span class="priority-dot ${priClass}" title="${escapeHtml(order.priority || "")}"></span> ` : ""}${escapeHtml(order.priority || "—")}</td>
          </tr>`;

          return [mainRow, orderListPositionsRow(order, allPositions, expanded, colspan)];
        })
        .join("")
    : `<tr><td colspan="${colspan}">${ordersEmptyHtml(filtersActive)}</td></tr>`;

  return `<div class="orders-list card" id="ordersList">
    <div class="table-wrap">
      <table class="orders-list-table">
        <thead>
          <tr>
            <th class="orders-list-expand" aria-label="Позиції"></th>
            <th>Номер</th>
            <th class="left">Клієнт</th>
            <th class="left">Об'єкт</th>
            <th>Менеджер</th>
            <th>Етап</th>
            <th>Статус</th>
            <th>Готово</th>
            <th>План</th>
            <th>Пріоритет</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

export function renderOrdersGrid(orders, positions, { filtersActive = false } = {}) {
  const rootPositions = positions.filter((p) => !p.parentId);
  const sorted = sortOrdersByAttention(orders, positions);
  const mode = state.ordersView.displayMode || "cards";
  const body =
    mode === "list"
      ? renderOrdersList(sorted, rootPositions, positions, filtersActive)
      : renderOrdersCards(sorted, rootPositions, positions, filtersActive);

  return `<div class="orders-view">${ordersModeBarHtml()}${body}</div>`;
}

export function renderOrderDetailHeader(order, positions, { canEditOrder = false } = {}) {
  const rootPositions = positions.filter((p) => !p.parentId);
  const main = mainPositionForOrder(order, rootPositions);
  const progress = main?.progress ?? 0;
  const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
  const priClass = priorityClass(order.priority);
  const positionCount = positionsForOrder(order, positions).filter((p) => !p.parentId).length;

  return `
    <div class="order-detail-head">
      <button type="button" class="btn btn-sm order-detail-back" data-orders-back>← Усі замовлення</button>
      <div class="order-detail-summary">
        <div class="order-detail-main">
          <h2 class="order-detail-title">${escapeHtml(order.orderNumber)}</h2>
          <p class="order-card-meta">${escapeHtml(order.client || "—")}</p>
          <p class="order-card-meta order-card-object">${escapeHtml(order.object || "—")}</p>
          <div class="order-detail-meta">
            ${badge(order.status || "—")}
            <span class="stage-pill">${escapeHtml(stage)}</span>
            <span class="order-card-meta order-detail-count">${positionCount} поз.</span>
            <span class="order-card-meta order-detail-plan">
              ${priClass ? `<span class="priority-dot ${priClass}" title="${escapeHtml(order.priority || "")}"></span>` : ""}
              План ${escapeHtml(order.planDate || "—")}${order.priority ? ` · ${escapeHtml(order.priority)}` : ""}
            </span>
          </div>
        </div>
        ${progressRing(progress, { size: 72 })}
      </div>
      ${
        canEditOrder
          ? `<button type="button" class="btn btn-sm" data-edit-order="${order.id}">Редагувати замовлення</button>`
          : ""
      }
    </div>`;
}

function openOrder(orderId, handlers) {
  const order = handlers.orders?.find((o) => o.id === Number(orderId));
  if (!order) return;
  if (shouldUseOrderDrawer()) {
    openOrderDetailDrawer(order.id);
    return;
  }
  if (handlers.onOrderClick) handlers.onOrderClick(order);
}

const swipeCleanups = [];

function bindOrderPositionsInline(root, handlers) {
  root?.querySelectorAll("[data-toggle-order-positions]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleOrderExpanded(btn.dataset.toggleOrderPositions);
      notifyUiChanged();
      window.__enverRender?.({ contentOnly: true });
    });
  });

  root?.querySelectorAll("[data-toggle-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePositionExpanded(Number(btn.dataset.togglePosition));
      notifyUiChanged();
      window.__enverRender?.({ contentOnly: true });
    });
  });

  root?.querySelectorAll("[data-open-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onOpenPosition?.(Number(btn.dataset.openPosition));
    });
  });
}

function bindOrderCards(root, handlers) {
  swipeCleanups.forEach((fn) => fn());
  swipeCleanups.length = 0;

  root?.querySelectorAll("[data-order-card]").forEach((card) => {
    const open = () => openOrder(card.dataset.orderCard, handlers);
    card.addEventListener("click", (e) => {
      if (card.dataset.swipeHandled) return;
      if (
        e.target.closest(
          "[data-order-cta], [data-order-detail], [data-toggle-order-positions], [data-toggle-position], [data-open-position]"
        )
      )
        return;
      open();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });

  root?.querySelectorAll("[data-order-detail]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openOrder(btn.dataset.orderDetail, handlers);
    });
  });

  root?.querySelectorAll("[data-order-cta]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const orderId = Number(btn.dataset.orderCta);
      const order = handlers.orders?.find((o) => o.id === orderId);
      if (handlers.onOrderCta && order) {
        await handlers.onOrderCta(order, btn);
        return;
      }
      openOrder(orderId, handlers);
    });
  });

  if (window.matchMedia("(pointer: coarse)").matches) {
    root?.querySelectorAll("[data-order-card]").forEach((card) => {
      const orderId = Number(card.dataset.orderCard);
      const order = handlers.orders?.find((o) => o.id === orderId);
      const ctl = createSwipeActions(card, {
        onSwipeRight: async () => {
          if (handlers.onOrderCta && order) {
            await handlers.onOrderCta(order);
            return;
          }
          openOrder(orderId, handlers);
        },
        onSwipeLeft: () => openOrder(orderId, handlers)
      });
      swipeCleanups.push(() => ctl.destroy());
    });
  }

  bindOrderPositionsInline(root, handlers);
}

function bindOrdersList(root, handlers) {
  bindOrderPositionsInline(root, handlers);
  root?.querySelectorAll("[data-order-list-row]").forEach((row) => {
    const open = () => openOrder(row.dataset.orderListRow, handlers);
    row.addEventListener("click", (e) => {
      if (
        e.target.closest(
          "[data-toggle-order-positions], [data-toggle-position], [data-open-position]"
        )
      ) {
        return;
      }
      open();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

export function bindOrdersGrid(root, handlers) {
  root?.querySelectorAll("[data-orders-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ordersView.displayMode = btn.dataset.ordersMode;
      window.__enverRender?.({ contentOnly: true });
    });
  });

  const mode = state.ordersView.displayMode || "cards";
  if (mode === "list") {
    bindOrdersList(root, handlers);
  } else {
    bindOrderCards(root, { ...handlers, allPositions: handlers.positions });
  }
}

export function bindOrderDetailBack(root, onBack) {
  root?.querySelector("[data-orders-back]")?.addEventListener("click", onBack);
}
