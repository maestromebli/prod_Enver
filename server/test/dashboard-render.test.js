import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDashboard } from "../../client/src/dashboard.js";
import { state } from "../../client/src/state.js";

function mockDocument(filters = {}) {
  const nodes = {
    "#searchInput": { value: filters.search || "" },
    "#statusFilter": { value: filters.status || "" },
    "#responsibleFilter": { value: filters.responsible || "" }
  };
  return {
    querySelector(selector) {
      return nodes[selector] || null;
    }
  };
}

function withStateSnapshot(fn) {
  const snapshot = {
    orders: state.orders,
    positions: state.positions,
    kpis: state.kpis,
    currentUser: state.currentUser
  };
  const originalDocument = global.document;
  try {
    fn();
  } finally {
    state.orders = snapshot.orders;
    state.positions = snapshot.positions;
    state.kpis = snapshot.kpis;
    state.currentUser = snapshot.currentUser;
    global.document = originalDocument;
  }
}

describe("dashboard render", () => {
  it("показує KPI по всіх позиціях навіть при активному фільтрі", () => {
    withStateSnapshot(() => {
      state.currentUser = { name: "Тест Користувач" };
      state.orders = [{ id: 1, orderNumber: "E-001", client: "Клієнт", object: "Об'єкт" }];
      state.positions = [
        {
          id: 1,
          orderId: 1,
          orderNumber: "E-001",
          object: "Об'єкт",
          item: "Кухня",
          positionStatus: "Проблема",
          overdueDays: 2,
          progress: 40
        },
        {
          id: 2,
          orderId: 1,
          orderNumber: "E-001",
          object: "Об'єкт",
          item: "Шафа",
          positionStatus: "Готово до встановлення",
          overdueDays: 0,
          progress: 100
        }
      ];
      state.kpis = null;
      global.document = mockDocument({ search: "шафа" });

      const html = renderDashboard();
      assert.match(html, /Показано списки за фільтрами/);
      assert.match(html, />1<\/span>\s*<span class="dash-tile-label">Проблеми<\/span>/);
      assert.match(html, />1<\/span>\s*<span class="dash-tile-label">До монтажу<\/span>/);
    });
  });

  it("додає aria-атрибути для регіонів і кнопок", () => {
    withStateSnapshot(() => {
      state.currentUser = { name: "Тест" };
      state.orders = [];
      state.positions = [];
      state.kpis = null;
      global.document = mockDocument();

      const html = renderDashboard();
      assert.match(html, /role="region" aria-label="У фокусі"/);
      assert.match(html, /class="dash-tile dash-tile--stat/);
      assert.match(html, /aria-label="Проблеми: 0\. потребують уваги"/);
    });
  });
});
