import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { PRODUCTION_FLOOR_TAB } from "../src/users-constants.js";
import { state } from "../src/state.js";
import {
  applyUiState,
  captureUiState,
  clearPersistedUiState,
  loadPersistedUiState,
  persistUiState
} from "../src/ui-persistence.js";

function installSessionStorageMock() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  return store;
}

function installBrowserMocks() {
  globalThis.window = { scrollY: 0 };
  globalThis.document = {
    querySelector: () => null,
    dispatchEvent: () => {}
  };
}

describe("ui-persistence", () => {
  beforeEach(() => {
    installSessionStorageMock();
    installBrowserMocks();
    clearPersistedUiState();
    state.view = "main";
    state.activeTab = "Замовлення";
    state.listFilters = { search: "", status: "", responsible: "" };
    state.showArchived = false;
    state.ordersView.detailTab = "overview";
    state.selectedOrderId = null;
  });

  it("мігрує старі назви вкладок і відновлює фільтри після reload", () => {
    sessionStorage.setItem(
      "enver_ui_state",
      JSON.stringify({
        v: 4,
        view: "main",
        activeTab: "Виробництво за етапами",
        filters: {
          search: "тест",
          status: "Проблема",
          responsible: "Іван",
          productionStageFilter: ""
        },
        showArchived: true,
        ordersView: { displayMode: "cards", priorityFilter: "", detailTab: "pos-12" },
        selectedOrderId: 5
      })
    );

    const snapshot = loadPersistedUiState();
    assert.ok(snapshot);
    assert.equal(snapshot.activeTab, PRODUCTION_FLOOR_TAB);

    const restored = applyUiState(snapshot);
    assert.equal(restored, true);
    assert.equal(state.activeTab, PRODUCTION_FLOOR_TAB);
    assert.equal(state.listFilters.search, "тест");
    assert.equal(state.listFilters.status, "Проблема");
    assert.equal(state.showArchived, true);
    assert.equal(state.ordersView.detailTab, "pos-12");
    assert.equal(state.selectedOrderId, 5);
  });

  it("captureUiState зберігає listFilters і detailTab у sessionStorage", () => {
    state.activeTab = "Замовлення";
    state.ordersView.displayMode = "positions";
    state.listFilters = { search: "abc", status: "В роботі", responsible: "Петро" };
    state.ordersView.detailTab = "pos-3";
    state.showArchived = true;

    persistUiState();
    const raw = JSON.parse(sessionStorage.getItem("enver_ui_state"));
    assert.equal(raw.v, 7);
    assert.equal(raw.filters.search, "abc");
    assert.equal(raw.ordersView.detailTab, "pos-3");
    assert.equal(raw.ordersView.positionsColumnPreset, "manager");
    assert.equal(raw.showArchived, true);

    const roundtrip = captureUiState();
    assert.equal(roundtrip.filters.status, "В роботі");
  });
});
