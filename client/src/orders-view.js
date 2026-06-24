import { stageLabel } from "@enver/shared/production/stages.js";
import {
  orderAttentionFromGodmode,
  renderHealthBadge,
  renderAttentionBadge,
  sortOrdersByAttention
} from "./godmode-ui.js";
import { positionsForOrder } from "./workflows.js";
import { state } from "./state.js";
import { escapeHtml, progressRing, badge } from "./utils.js";

const DISPLAY_LABELS = { cards: "Картки", list: "Список" };

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
  return `<div class="enver-progress order-card-progress" aria-label="${v}% готово">
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
    ${hasCta ? `<button type="button" class="order-card-cta" data-order-cta="${order.id}">${escapeHtml(ctaLabel)}</button>` : ""}
    <button type="button" class="order-card-cta order-card-cta--secondary" data-order-detail="${order.id}">Деталі</button>
  </div>`;
}

function ordersEmptyHtml() {
  return `<div class="enver-empty-state orders-empty">
    <span class="enver-empty-state-icon" aria-hidden="true">📋</span>
    <h3 class="enver-empty-state-title">Поки немає замовлень</h3>
    <p class="enver-empty-state-text">Створіть перше замовлення, щоб запустити виробничий workflow.</p>
  </div>`;
}

function renderOrdersCards(orders, rootPositions, allPositions) {
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
      const healthBadge = gm ? renderHealthBadge(gm.health) : "";
      const attentionBadge = gm ? renderAttentionBadge(gm.attentionScore) : "";
      const nextLine = nextLabel
        ? `<p class="order-card-stage-line">Далі: <strong>${escapeHtml(nextLabel)}</strong></p>`
        : "";

      return `
        <article class="order-card ${cardClass}" data-order-card="${order.id}" tabindex="0">
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
          </div>
          ${orderCardActions(order, attn)}
        </article>`;
    })
    .join("");

  return `<div class="orders-grid">${cards || ordersEmptyHtml()}</div>`;
}

function renderOrdersList(orders, rootPositions, allPositions) {
  const rows = orders.length
    ? orders
        .map((order) => {
          const main = mainPositionForOrder(order, rootPositions);
          const progress = main?.progress ?? 0;
          const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
          const priClass = priorityClass(order.priority);
          const attn = orderAttentionFromGodmode(order, allPositions);
          const rowClass = attn.attentionCount > 0 ? "orders-list-row--attention" : "";

          return `<tr class="orders-list-row row-clickable ${rowClass}" data-order-list-row="${order.id}" tabindex="0">
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
        })
        .join("")
    : `<tr><td colspan="9"><div class="enver-empty-state">
        <span class="enver-empty-state-icon" aria-hidden="true">📋</span>
        <h3 class="enver-empty-state-title">Поки немає замовлень</h3>
        <p class="enver-empty-state-text">Створіть перше замовлення, щоб запустити виробничий workflow.</p>
      </div></td></tr>`;

  return `<div class="orders-list card" id="ordersList">
    <div class="table-wrap">
      <table class="orders-list-table">
        <thead>
          <tr>
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

export function renderOrdersGrid(orders, positions) {
  const rootPositions = positions.filter((p) => !p.parentId);
  const sorted = sortOrdersByAttention(orders, positions);
  const mode = state.ordersView.displayMode || "cards";
  const body =
    mode === "list"
      ? renderOrdersList(sorted, rootPositions, positions)
      : renderOrdersCards(sorted, rootPositions, positions);

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

function openOrder(orderId, { onOrderClick, orders }) {
  const order = orders.find((o) => o.id === Number(orderId));
  if (order && onOrderClick) onOrderClick(order);
}

function bindOrderCards(root, handlers) {
  root?.querySelectorAll("[data-order-card]").forEach((card) => {
    const open = () => openOrder(card.dataset.orderCard, handlers);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-order-cta], [data-order-detail]")) return;
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
        await handlers.onOrderCta(order);
        return;
      }
      openOrder(orderId, handlers);
    });
  });
}

function bindOrdersList(root, handlers) {
  root?.querySelectorAll("[data-order-list-row]").forEach((row) => {
    const open = () => openOrder(row.dataset.orderListRow, handlers);
    row.addEventListener("click", open);
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
    bindOrderCards(root, handlers);
  }
}

export function bindOrderDetailBack(root, onBack) {
  root?.querySelector("[data-orders-back]")?.addEventListener("click", onBack);
}
