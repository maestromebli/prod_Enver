import { stageLabel } from "@enver/shared/production/stages.js";
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

function renderOrdersCards(orders, rootPositions) {
  const cards = orders
    .map((order) => {
      const main = mainPositionForOrder(order, rootPositions);
      const progress = main?.progress ?? 0;
      const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
      const priClass = priorityClass(order.priority);

      return `
        <article class="order-card" data-order-card="${order.id}" tabindex="0">
          <div class="order-card-head">
            <div class="order-card-body">
              <h3 class="order-card-title">${escapeHtml(order.orderNumber)}</h3>
              <p class="order-card-meta">${escapeHtml(order.client || "—")}</p>
              <p class="order-card-meta order-card-object">${escapeHtml(order.object || "—")}</p>
            </div>
            ${progressRing(progress, { size: 72 })}
          </div>
          <div class="order-card-foot">
            <span class="stage-pill">${escapeHtml(stage)}</span>
            ${badge(order.status || "—")}
          </div>
          <p class="order-card-meta" style="margin-top:10px;display:flex;align-items:center;gap:8px">
            ${priClass ? `<span class="priority-dot ${priClass}" title="${escapeHtml(order.priority || "")}"></span>` : ""}
            <span>План ${escapeHtml(order.planDate || "—")}${order.priority ? ` · ${escapeHtml(order.priority)}` : ""}</span>
          </p>
        </article>`;
    })
    .join("");

  return `<div class="orders-grid">${cards || '<p class="empty orders-empty">Немає замовлень — створіть перше</p>'}</div>`;
}

function renderOrdersList(orders, rootPositions) {
  const rows = orders.length
    ? orders
        .map((order) => {
          const main = mainPositionForOrder(order, rootPositions);
          const progress = main?.progress ?? 0;
          const stage = main?.currentStage ? stageLabel(main.currentStage) : "Конструктив";
          const priClass = priorityClass(order.priority);

          return `<tr class="orders-list-row row-clickable" data-order-list-row="${order.id}" tabindex="0">
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
    : `<tr><td colspan="9" class="empty-cell">Немає замовлень — створіть перше</td></tr>`;

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
  const mode = state.ordersView.displayMode || "cards";
  const body =
    mode === "list"
      ? renderOrdersList(orders, rootPositions)
      : renderOrdersCards(orders, rootPositions);

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
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
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
