import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml, progressRing, badge } from "./utils.js";

export function renderOrdersGrid(orders, positions, { onOrderClick: _onOrderClick } = {}) {
  const rootPositions = positions.filter((p) => !p.parentId);

  const cards = orders
    .map((order) => {
      const related = rootPositions.filter(
        (p) => p.orderId === order.id || p.orderNumber === order.orderNumber
      );
      const main = related[0];
      const progress = main?.progress ?? 0;
      const stage = main?.currentStage ? stageLabel(main.currentStage) : "—";

      return `
        <article class="order-card" data-order-card="${order.id}" tabindex="0">
          <div class="order-card-head">
            <div>
              <h3 class="order-card-title">${escapeHtml(order.orderNumber)}</h3>
              <p class="order-card-meta">${escapeHtml(order.client || "—")} · ${escapeHtml(order.object || "—")}</p>
              <p class="order-card-meta">${badge(order.status || "—")} · ${escapeHtml(stage)}</p>
            </div>
            ${progressRing(progress, { size: 64 })}
          </div>
          <p class="order-card-meta" style="margin-top:10px">План: ${escapeHtml(order.planDate || "—")} · ${escapeHtml(order.priority || "—")}</p>
        </article>`;
    })
    .join("");

  return `
    <div class="orders-view">
      <div class="card-header-row">
        <div>
          <h2 class="block-title" style="margin:0">Замовлення</h2>
          <p class="positions-hint">Картки з прогресом і поточним етапом. Натисніть, щоб відкрити позицію.</p>
        </div>
      </div>
      <div class="orders-grid">${cards || '<p class="empty">Немає замовлень</p>'}</div>
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
