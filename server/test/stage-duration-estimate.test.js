import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePackageStageMetrics,
  countEdgedSides,
  parseDimensionMm
} from "../../shared/production/stage-metrics.js";
import {
  estimateStageDuration,
  formatStageEstimateLabel,
  estimateFinishAt
} from "../../shared/production/stage-duration-estimate.js";

describe("shared/production/stage-metrics", () => {
  it("parseDimensionMm читає розміри", () => {
    assert.equal(parseDimensionMm("600"), 600);
    assert.equal(parseDimensionMm("720,5"), 721);
  });

  it("computePackageStageMetrics рахує метраж", () => {
    const metrics = computePackageStageMetrics(
      [
        { length: "600", width: "400", qty: 2, edgeCode: "1111", material: "ДСП 18" },
        { length: "800", width: "300", qty: 1, edgeCode: "0110", material: "ДСП 18" }
      ],
      [{ name: "Петля", qty: "4" }]
    );
    assert.equal(metrics.partsCount, 3);
    assert.ok(metrics.cutLengthMm > 0);
    assert.ok(metrics.edgeLengthMm > 0);
    assert.ok(metrics.drillPoints > 0);
    assert.ok(metrics.hardwareCount >= 4);
  });

  it("countEdgedSides з маски", () => {
    assert.equal(countEdgedSides("1111"), 4);
    assert.equal(countEdgedSides("0110"), 2);
    assert.equal(countEdgedSides(""), 0);
  });
});

describe("shared/production/stage-duration-estimate", () => {
  const history = [
    {
      stage_key: "cutting",
      user_id: 1,
      active_seconds: 3600,
      parts_count: 20,
      cut_length_mm: 120000,
      edge_length_mm: 0,
      drill_points: 0,
      hardware_count: 0,
      material_summary: "ДСП 18"
    },
    {
      stage_key: "cutting",
      user_id: 2,
      active_seconds: 3000,
      parts_count: 20,
      cut_length_mm: 100000,
      edge_length_mm: 0,
      drill_points: 0,
      hardware_count: 0,
      material_summary: "ДСП 18"
    }
  ];

  it("estimateStageDuration для порізки з історією", () => {
    const est = estimateStageDuration(
      "cutting",
      { partsCount: 20, cutLengthMm: 110000, materialSummary: "ДСП 18" },
      history
    );
    assert.ok(est.estimatedMinutes >= 5);
    assert.ok(est.confidence >= 0.5);
    assert.equal(est.metrics.cutMeters, 110);
  });

  it("estimateStageDuration для збірки з фурнітурою", () => {
    const est = estimateStageDuration(
      "assembly",
      { partsCount: 30, hardwareCount: 15, materialSummary: "ДСП" },
      [
        {
          stage_key: "assembly",
          active_seconds: 7200,
          parts_count: 25,
          hardware_count: 12,
          material_summary: "ДСП"
        }
      ]
    );
    assert.ok(est.estimatedMinutes > 0);
  });

  it("formatStageEstimateLabel і estimateFinishAt", () => {
    assert.equal(formatStageEstimateLabel({ estimatedMinutes: 75 }), "~1 год 15 хв");
    const finish = estimateFinishAt(new Date("2026-06-29T10:00:00Z"), 90);
    assert.ok(finish > new Date("2026-06-29T10:00:00Z"));
  });
});
