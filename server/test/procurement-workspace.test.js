import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getProcurementBlockers,
  getProcurementWarnings,
  isDeliveryAtRisk,
  isDeliveryOverdue,
  isItemFullyReceived,
  mtoCategoryLabel,
  summarizeProcurementItems
} from "../../shared/production/procurement.js";

describe("procurement workspace", () => {
  it("mtoCategoryLabel — українські підписи", () => {
    assert.equal(mtoCategoryLabel("facade_agt"), "Фасади AGT");
    assert.equal(mtoCategoryLabel("sliding_system"), "Розсувна система");
  });

  it("isItemFullyReceived", () => {
    assert.equal(isItemFullyReceived({ qty: "2", qtyReceived: 2 }), true);
    assert.equal(isItemFullyReceived({ qty: "2", qtyReceived: 1 }), false);
  });

  it("summarizeProcurementItems — блокуючі MTO", () => {
    const summary = summarizeProcurementItems([
      { procurementClass: "mto", category: "mirror", qty: "1", qtyReceived: 0, status: "ordered" },
      { procurementClass: "spec", category: "", qty: "5", qtyReceived: 5, status: "received" }
    ]);
    assert.equal(summary.blockingCount, 1);
    assert.equal(summary.allBlockingReceived, false);
  });

  it("isDeliveryOverdue і isDeliveryAtRisk", () => {
    const past = { expectedDeliveryDate: "2020-01-01", qty: "1", qtyReceived: 0 };
    assert.equal(isDeliveryOverdue(past, new Date("2026-06-01")), true);
    const risk = {
      expectedDeliveryDate: "2026-06-20",
      requiredByDate: "2026-06-10",
      qty: "1",
      qtyReceived: 0
    };
    assert.equal(isDeliveryAtRisk(risk), true);
  });

  it("getProcurementBlockers на збірці", () => {
    const blockers = getProcurementBlockers(
      [{ category: "facade_agt", qty: "1", qtyReceived: 0, status: "ordered" }],
      { currentStage: "assembly" }
    );
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].type, "procurement_blocks_assembly");
  });

  it("getProcurementWarnings — прострочення", () => {
    const warnings = getProcurementWarnings(
      [
        {
          procurementClass: "mto",
          category: "mirror",
          expectedDeliveryDate: "2020-01-01",
          qty: "1",
          qtyReceived: 0
        }
      ],
      { currentStage: "assembly" }
    );
    assert.ok(warnings.some((w) => w.type === "procurement_overdue"));
  });
});
