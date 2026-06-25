import { renderOrderDetailView, bindOrderDetail } from "./order-detail.js";
import { positionsForOrder } from "./workflows.js";
import { activePositions } from "./archive.js";
import { state } from "./state.js";
import { $ } from "./utils.js";

let drawerOrderId = null;
let onCloseCallback = () => {};

function backdrop() {
  return $("#orderDetailDrawer");
}

export function isOrderDetailDrawerOpen() {
  return Boolean(drawerOrderId && backdrop()?.classList.contains("open"));
}

/** Drawer лише на мобільних; на desktop — повна картка замовлення. */
export function shouldUseOrderDrawer() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function skeletonHtml() {
  return `
    <div class="order-drawer-skeleton">
      <div class="enver-skeleton" style="height:28px;width:60%;margin-bottom:12px"></div>
      <div class="enver-skeleton" style="height:16px;width:80%;margin-bottom:20px"></div>
      <div class="enver-skeleton enver-skeleton-card"></div>
    </div>`;
}

function paintDrawer() {
  const order = state.orders.find((o) => o.id === drawerOrderId);
  const body = $("#orderDetailDrawerBody");
  if (!order || !body) return;
  const related = positionsForOrder(order, activePositions(state.positions, state.orders));
  body.innerHTML = renderOrderDetailView(order, state.positions, related).replace(
    'class="orders-view orders-view--detail',
    'class="orders-view orders-view--detail orders-view--drawer'
  );
  bindDrawerActions(body);
}

function bindDrawerActions(body) {
  bindOrderDetail(body, {
    onBack: closeOrderDetailDrawer,
    onRefresh: () => paintDrawer(),
    onOpenPosition: async (id) => {
      closeOrderDetailDrawer();
      const { openPositionDrawer } = await import("./positions.js");
      const position = state.positions.find((p) => p.id === id);
      if (position) openPositionDrawer(position);
    },
    onEditOrder: async (id) => {
      const { openOrderModal } = await import("./orders.js");
      const order = state.orders.find((o) => o.id === id);
      if (order) openOrderModal(order);
    }
  });
}

export function openOrderDetailDrawer(orderId, { tab = "overview", onClose } = {}) {
  const order = state.orders.find((o) => o.id === Number(orderId));
  if (!order) return;
  drawerOrderId = order.id;
  state.ordersView.detailTab = tab;
  onCloseCallback = onClose || (() => {});

  const el = backdrop();
  if (!el) return;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("order-drawer-open");

  const body = $("#orderDetailDrawerBody");
  if (body) {
    body.innerHTML = skeletonHtml();
    requestAnimationFrame(() => paintDrawer());
  }

  const onKey = (e) => {
    if (e.key === "Escape") closeOrderDetailDrawer();
  };
  document.addEventListener("keydown", onKey);
  el._onKey = onKey;
}

export function closeOrderDetailDrawer() {
  const el = backdrop();
  if (!el) return;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  document.body.classList.remove("order-drawer-open");
  if (el._onKey) {
    document.removeEventListener("keydown", el._onKey);
    el._onKey = null;
  }
  drawerOrderId = null;
  onCloseCallback();
}

export function initOrderDetailDrawer() {
  if (backdrop()) return;
  const el = document.createElement("div");
  el.id = "orderDetailDrawer";
  el.className = "drawer-backdrop order-detail-drawer";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="drawer order-detail-drawer-panel" role="dialog" aria-labelledby="orderDetailDrawerTitle">
      <div class="drawer-header">
        <div class="drawer-header-main">
          <h2 id="orderDetailDrawerTitle">Замовлення</h2>
          <p class="enver-meta">Швидкий перегляд</p>
        </div>
        <button type="button" class="btn btn-sm enver-pressable" id="orderDetailDrawerClose" aria-label="Закрити">✕</button>
      </div>
      <div class="drawer-body" id="orderDetailDrawerBody"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    if (e.target === el) closeOrderDetailDrawer();
  });
  $("#orderDetailDrawerClose")?.addEventListener("click", closeOrderDetailDrawer);
}
