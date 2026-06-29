import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edgeSideMask,
  formatEdgeCodeLabel,
  splitPartBazisOperations,
  operationFaceIndexFromCode
} from "../../shared/production/part-detail-display.js";

describe("part-detail-display", () => {
  it("edgeSideMask читає 4-значний код", () => {
    assert.deepEqual(edgeSideMask("1110"), [true, true, true, false]);
    assert.deepEqual(edgeSideMask("0000"), [false, false, false, false]);
  });

  it("formatEdgeCodeLabel", () => {
    assert.match(formatEdgeCodeLabel("1110"), /1110/);
    assert.equal(formatEdgeCodeLabel("0000"), "Без кромки");
  });

  it("operationFaceIndexFromCode", () => {
    assert.equal(operationFaceIndexFromCode("0010X002X1"), 1);
    assert.equal(operationFaceIndexFromCode("0010X002X2"), 2);
  });

  it("splitPartBazisOperations ділить лиця 1 і 2", () => {
    const part = {
      partNo: "10",
      bazisOperationCodes: ["0010X002X1", "0010X002X2", "0011X003X1"]
    };
    const { edging, drilling } = splitPartBazisOperations(part);
    assert.deepEqual(edging, ["0010X002X1"]);
    assert.deepEqual(drilling, ["0010X002X2"]);
  });
});
