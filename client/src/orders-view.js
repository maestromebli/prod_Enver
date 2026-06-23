import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml, progressRing, badge } from "./utils.js";

function priorityClass(priority) {
  const p = String(priority || "").toLowerCase();
  if (p.includes("висок")) return "priority-dot--high";
  if (p.includes("низ")) return "priority-dot--low";
  return "";
}

export function renderOrdersGrid(orders, positions, { onOrderClick: _onOrderClick } = {}) {
  const rootPositions = positions.filter((p) => !p.parentId);

  const cards = orders
    .map((order) => {
      const related = rootPositions.filter(
        (p) => p.orderId === order.id || p.orderNumber === order.orderNumber
      );
      const main = related[0];
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

  return `
    <div class="orders-view">
      <div class="orders-grid">${cards || '<p class="empty" style="padding:24px;color:var(--v3-muted)">Немає замовлень — створіть перше</p>'}</div>
    </div>`;
}

export function bindOrdersGrid(root, { onOpenPosition, orders, positions }) {
  root?.querySelectorAll("[data-order-card]").forEach((card) => {
    const open = () => {
      const orderId = Number(card.dataset.orderCard);
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      const pos = positions.find(
        (p) => !p.parentId && (p.orderId === order.id || p.orderNumber === order.orderNumber)
      );
      if (pos && onOpenPosition) onOpenPosition(pos);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}
