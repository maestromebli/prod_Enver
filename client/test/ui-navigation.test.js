import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TABS,
  CONSTRUCTOR_DESK_TAB,
  PRODUCTION_FLOOR_TAB,
  ATTENTION_TAB,
  PROCUREMENT_TAB
} from "../src/constants.js";
import { DASHBOARD_NAV_ROUTES, resolveDashboardNav } from "../src/dashboard-routes.js";
import { buildGodmodeCtaAttrs } from "../../shared/production/godmode-ui-helpers.js";
import { effectivePermissions } from "../src/auth.js";
import { state } from "../src/state.js";

describe("UI navigation contracts", () => {
  it("усі маршрути дашборду ведуть на існуючі вкладки", () => {
    for (const [label, route] of Object.entries(DASHBOARD_NAV_ROUTES)) {
      assert.ok(TABS.includes(route.tab), `маршрут «${label}» → невідома вкладка «${route.tab}»`);
    }
  });

  it("resolveDashboardNav — прямі вкладки та зворотна сумісність", () => {
    assert.equal(resolveDashboardNav("Замовлення").tab, "Замовлення");
    assert.equal(resolveDashboardNav(PRODUCTION_FLOOR_TAB).tab, PRODUCTION_FLOOR_TAB);
    assert.equal(resolveDashboardNav("Виробництво за етапами").tab, PRODUCTION_FLOOR_TAB);
    assert.equal(resolveDashboardNav("Проблеми").tab, ATTENTION_TAB);
    assert.equal(resolveDashboardNav("Проблеми").status, undefined);
    assert.equal(resolveDashboardNav("Архів").archived, true);
  });

  it("buildGodmodeCtaAttrs — UI-дії з позицією", () => {
    const upload = buildGodmodeCtaAttrs(
      { type: "upload_constructive", allowed: true },
      { positionId: 9 }
    );
    assert.match(upload, /data-open-constructor-desk-position="9"/);
    assert.match(upload, /data-constructor-ws-tab="package"/);

    const manager = buildGodmodeCtaAttrs(
      { type: "fill_manager_data", allowed: true },
      { positionId: 4 }
    );
    assert.match(manager, /data-order-detail-tab="pos-4"/);

    const addPos = buildGodmodeCtaAttrs({ type: "add_position", allowed: true }, { orderId: 2 });
    assert.match(addPos, /data-focus-inline-add="1"/);
  });

  it("buildGodmodeCtaAttrs — стіл конструктора", () => {
    const byPosition = buildGodmodeCtaAttrs(
      { type: "assign_constructor", allowed: true },
      { orderId: 5, positionId: 12 }
    );
    assert.match(byPosition, /data-order-detail-tab="pos-12"/);
    assert.match(byPosition, /data-focus-responsibles="1"/);

    const byOrder = buildGodmodeCtaAttrs(
      { type: "assign_constructor", allowed: true },
      { orderId: 5 }
    );
    assert.match(byOrder, /data-open-constructor-desk-order="5"/);
  });

  it("назва вкладки конструктора узгоджена з TABS", () => {
    assert.equal(CONSTRUCTOR_DESK_TAB, "Конструктори");
    assert.ok(TABS.includes(CONSTRUCTOR_DESK_TAB));
    assert.ok(!TABS.includes("Конструктив"), "«Конструктив» — підвкладка, не головна вкладка");
  });

  it("вкладка закупівлі в головній навігації", () => {
    assert.ok(TABS.includes("Закупівля"));
    assert.equal(resolveDashboardNav(PROCUREMENT_TAB).tab, PROCUREMENT_TAB);
    assert.equal(DASHBOARD_NAV_ROUTES.Закупівля.tab, PROCUREMENT_TAB);
  });

  it("менеджер бачить закупівлю через effectivePermissions", () => {
    state.currentUser = { role: "manager", permissions: { canEditOrders: true } };
    assert.equal(Boolean(effectivePermissions().canManageProcurement), true);
    state.currentUser = null;
  });
});
