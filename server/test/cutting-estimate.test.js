import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateCuttingMinutes, formatEstimateLabel, median } from "../src/cutting-estimate.js";

describe("cutting-estimate", () => {
  it("median обчислює середину", () => {
    assert.equal(median([10, 20, 30]), 20);
    assert.equal(median([10, 20]), 15);
  });

  it("estimateCuttingMinutes без історії — базова оцінка", () => {
    const est = estimateCuttingMinutes({ piecesTotal: 10, material: "ДСП" }, []);
    assert.ok(est.estimatedMinutes >= 15);
    assert.equal(est.method, "default");
  });

  it("estimateCuttingMinutes з історією", () => {
    const history = [
      { duration_sec: 3600, pieces_total: 20, cut_length_mm: 0, material: "ДСП 18" },
      { duration_sec: 3000, pieces_total: 20, cut_length_mm: 0, material: "ДСП 18" }
    ];
    const est = estimateCuttingMinutes({ piecesTotal: 20, material: "ДСП" }, history);
    assert.ok(est.estimatedMinutes > 0);
    assert.ok(est.confidence >= 0.4);
  });

  it("formatEstimateLabel", () => {
    assert.equal(formatEstimateLabel({ estimatedMinutes: 90 }), "~1 год 30 хв");
    assert.equal(formatEstimateLabel({ estimatedMinutes: 45 }), "~45 хв");
  });
});
