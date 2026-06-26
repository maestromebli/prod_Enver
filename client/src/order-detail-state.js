import { state } from "./state.js";
import { clearAllPositionOrderTabCache } from "./position-order-tab.js";

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
  state.ordersView.order3dAssets = {};
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
