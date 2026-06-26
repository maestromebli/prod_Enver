import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearOrderDetailViewState, openPositionInOrderDetail } from "../src/order-detail-state.js";
import { state } from "../src/state.js";

describe("order-detail-state", () => {
  it("openPositionInOrderDetail перемикає вкладку", () => {
    state.positions = [{ id: 5, orderId: 2 }];
    state.selectedOrderId = null;
    state.activeTab = "Позиції";
    state.ordersView = { detailTab: "overview", positionSubTab: {} };

    const ok = openPositionInOrderDetail(5, "manager");
    assert.equal(ok, true);
    assert.equal(state.selectedOrderId, 2);
    assert.equal(state.activeTab, "Замовлення");
    assert.equal(state.ordersView.detailTab, "pos-5");
    assert.equal(state.ordersView.positionSubTab[5], "manager");
  });

  it("openPositionInOrderDetail — невалідний id", () => {
    assert.equal(openPositionInOrderDetail("x"), false);
  });

  it("clearOrderDetailViewState скидає кеш", () => {
    state.ordersView = {
      positionBundles: { 1: {} },
      positionTabDownstream: { 1: {} },
      positionSubTab: { 1: "manager" },
      detailTab: "pos-1"
    };
    clearOrderDetailViewState();
    assert.deepEqual(state.ordersView.positionBundles, {});
    assert.equal(state.ordersView.detailTab, "overview");
  });
});
