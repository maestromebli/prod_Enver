import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROCUREMENT_STATUSES,
  isValidProcurementStatusTransition,
  nextProcurementStatus,
  procurementStatusLabel
} from "../../shared/production/constructive-package.js";

describe("procurement registry", () => {
  it("усі статуси закупівлі мають українські підписи", () => {
    for (const status of PROCUREMENT_STATUSES) {
      const label = procurementStatusLabel(status);
      assert.ok(label && label !== status, `немає підпису для ${status}`);
    }
  });

  it("переходи статусів закупівлі — лише вперед по pipeline", () => {
    assert.equal(nextProcurementStatus("draft"), "waiting_approval");
    assert.equal(isValidProcurementStatusTransition("draft", "waiting_approval"), true);
    assert.equal(isValidProcurementStatusTransition("draft", "received"), false);
    assert.equal(isValidProcurementStatusTransition("approved", "rejected"), true);
    assert.equal(isValidProcurementStatusTransition("received", "cancelled"), false);
  });
});
