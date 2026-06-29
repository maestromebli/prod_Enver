import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateLaborHeuristic,
  normalizePackageAiAnalysis,
  formatLaborHours,
  FURNITURE_TYPE_LABELS
} from "../../shared/production/package-ai.js";

describe("shared/production/package-ai", () => {
  it("estimateLaborHeuristic зростає з кількістю деталей", () => {
    const small = estimateLaborHeuristic({ partsCount: 10, hardwareCount: 5 });
    const large = estimateLaborHeuristic({ partsCount: 80, hardwareCount: 30 });
    assert.ok(large.totalHours > small.totalHours);
    assert.ok(large.stages.cutting > small.stages.cutting);
  });

  it("normalizePackageAiAnalysis визначає тип меблів", () => {
    const result = normalizePackageAiAnalysis(
      { furnitureType: "kitchen", summary: "Кухня 3.2м" },
      { partsCount: 40, hardwareCount: 12 }
    );
    assert.equal(result.furnitureType, "kitchen");
    assert.equal(result.furnitureTypeLabel, FURNITURE_TYPE_LABELS.kitchen);
    assert.ok(result.estimatedLabor.totalHours > 0);
  });

  it("normalizePackageAiAnalysis підставляє евристику якщо ШІ не дав час", () => {
    const result = normalizePackageAiAnalysis(
      { estimatedComplexity: "high" },
      { partsCount: 50, hardwareCount: 20 }
    );
    assert.equal(result.estimatedComplexity, "high");
    assert.ok(result.estimatedLabor.constructorHours >= 1);
    assert.ok(result.estimatedLabor.stages.cutting.minutes > 0);
  });

  it("formatLaborHours форматує години та хвилини", () => {
    assert.equal(formatLaborHours(0.5), "30 хв");
    assert.equal(formatLaborHours(2), "2 год");
    assert.equal(formatLaborHours(2.5), "2 год 30 хв");
  });
});
