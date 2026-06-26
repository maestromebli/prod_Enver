import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  godmodeContextFromRow,
  attachGodmodeToMappedPosition,
  enrichAndMapPosition,
  attachGodmodeToOrder
} from "../src/godmode-enrich.js";

const baseRow = {
  id: 1,
  parent_id: null,
  order_id: 10,
  order_number: "Е-50",
  object: "Кухня",
  item: "Нижні",
  item_type: "Зона",
  manager: "Admin",
  constructor_name: "",
  has_constructive_file: false,
  cutting_status: "Очікує",
  edging_status: "Очікує",
  drilling_status: "Очікує",
  assembly_status: "Очікує",
  packaging_status: "Очікує",
  position_status: "",
  plan_date: "2026-03-01"
};

describe("godmode-enrich", () => {
  it("godmodeContextFromRow — ai та planDate", () => {
    const ctx = godmodeContextFromRow(
      { ai_analysis_count: 2, plan_date: "2026-04-01" },
      { extra: true }
    );
    assert.equal(ctx.hasAiAnalysis, true);
    assert.equal(ctx.planDate, "2026-04-01");
    assert.equal(ctx.extra, true);
  });

  it("enrichAndMapPosition додає godmode", () => {
    const mapped = enrichAndMapPosition(baseRow, "2026-03-01");
    assert.equal(mapped.item, "Нижні");
    assert.ok(mapped.godmode);
    assert.ok(Array.isArray(mapped.godmode.actions) || mapped.godmode.nextAction);
  });

  it("attachGodmodeToOrder агрегує позиції", () => {
    const order = {
      id: 10,
      orderNumber: "Е-50",
      object: "Кухня",
      status: "Передано"
    };
    const withGod = attachGodmodeToOrder(order, [baseRow], { planDate: "2026-03-01" });
    assert.ok(withGod.godmode);
    assert.equal(withGod.orderNumber, "Е-50");
  });

  it("attachGodmodeToMappedPosition не дублює godmode", () => {
    const mapped = enrichAndMapPosition(baseRow, "2026-03-01");
    const again = attachGodmodeToMappedPosition(mapped, baseRow, {});
    assert.ok(again.godmode);
  });
});
