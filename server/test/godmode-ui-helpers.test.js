import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canQuickRunGodmodeAction,
  canAttentionQuickRun,
  isRunnableGodmodeAction,
  orderDetailSubTabForGodmodeAction,
  panelForGodmodeAction,
  shouldOpenOrderDetailForGodmodeAction,
  buildGodmodeCtaAttrs
} from "../../shared/production/godmode-ui-helpers.js";

describe("godmode UI helpers", () => {
  it("panelForGodmodeAction — install, constructive та more", () => {
    assert.equal(panelForGodmodeAction("schedule_install"), "install");
    assert.equal(panelForGodmodeAction("wait_install"), "install");
    assert.equal(panelForGodmodeAction("run_ai_analysis"), "constructive");
    assert.equal(panelForGodmodeAction("create_tasks_from_ai"), "constructive");
    assert.equal(panelForGodmodeAction("resolve_problem"), "more");
    assert.equal(panelForGodmodeAction("upload_constructive"), "general");
    assert.equal(panelForGodmodeAction("assign_constructor"), "general");
    assert.equal(panelForGodmodeAction("handoff_to_cutting"), "general");
  });

  it("canQuickRunGodmodeAction — handoff і close_order", () => {
    assert.equal(canQuickRunGodmodeAction("handoff_to_edging"), true);
    assert.equal(canQuickRunGodmodeAction("ready_for_install"), true);
    assert.equal(canQuickRunGodmodeAction("close_order"), true);
    assert.equal(canQuickRunGodmodeAction("upload_constructive"), false);
  });

  it("canAttentionQuickRun — розширені дії з вкладки уваги", () => {
    assert.equal(canAttentionQuickRun("create_procurement"), true);
    assert.equal(canAttentionQuickRun("schedule_install"), true);
    assert.equal(canAttentionQuickRun("parse_constructive_package"), true);
    assert.equal(canAttentionQuickRun("upload_constructive"), false);
  });

  it("isRunnableGodmodeAction — UI-дії не quick-run", () => {
    assert.equal(isRunnableGodmodeAction("add_position"), true);
    assert.equal(isRunnableGodmodeAction("create_tasks_from_ai"), false);
  });

  it("orderDetailSubTabForGodmodeAction — pipeline дії", () => {
    assert.equal(orderDetailSubTabForGodmodeAction("fill_manager_data"), "manager");
    assert.equal(orderDetailSubTabForGodmodeAction("parse_constructive_package"), "constructive");
    assert.equal(orderDetailSubTabForGodmodeAction("create_procurement"), "procurement");
    assert.equal(orderDetailSubTabForGodmodeAction("release_to_cnc"), "cnc");
    assert.equal(orderDetailSubTabForGodmodeAction("upload_constructive"), null);
    assert.equal(orderDetailSubTabForGodmodeAction("upload_constructive_package"), null);
    assert.equal(orderDetailSubTabForGodmodeAction("schedule_install"), "install");
    assert.equal(shouldOpenOrderDetailForGodmodeAction("assign_constructor"), true);
  });

  it("buildGodmodeCtaAttrs — завантаження конструктива на стіл", () => {
    const attrs = buildGodmodeCtaAttrs(
      { type: "upload_constructive", allowed: true },
      { positionId: 9 }
    );
    assert.match(attrs, /data-open-constructor-desk-position="9"/);
    assert.match(attrs, /data-constructor-ws-tab="package"/);
  });

  it("buildGodmodeCtaAttrs — assign_constructor на огляді замовлення", () => {
    const attrs = buildGodmodeCtaAttrs(
      { type: "assign_constructor", allowed: true },
      { orderId: 5, positionId: 12 }
    );
    assert.match(attrs, /data-order-detail-tab="pos-12"/);
    assert.match(attrs, /data-focus-responsibles="1"/);
  });

  it("buildGodmodeCtaAttrs — assign_constructor лише з orderId", () => {
    const attrs = buildGodmodeCtaAttrs(
      { type: "assign_constructor", allowed: true },
      { orderId: 5 }
    );
    assert.match(attrs, /data-open-constructor-desk-order="5"/);
  });
});
