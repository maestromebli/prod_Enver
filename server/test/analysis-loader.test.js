import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichPackageAnalysisForAuto } from "../src/automation/analysis-loader.js";
import { normalizePackageAiAnalysis } from "../../shared/production/package-ai.js";

describe("enrichPackageAnalysisForAuto", () => {
  it("враховує дані розбору пакета для quality", () => {
    const analysis = normalizePackageAiAnalysis(
      {
        summary: "Кухня 3.2м",
        suggestedTasks: [
          { stage: "cutting", needed: true, reason: "деталі", confidence: 0.88 },
          { stage: "edging", needed: true, reason: "крайка", confidence: 0.9 },
          { stage: "drilling", needed: true, reason: "петлі", confidence: 0.85 },
          { stage: "assembly", needed: true, reason: "збірка", confidence: 0.86 }
        ]
      },
      { partsCount: 42, hardwareCount: 15 }
    );

    enrichPackageAnalysisForAuto(analysis, {
      partsCount: 42,
      materialsCount: 3,
      hardwareCount: 15,
      materialNames: ["ДСП 18", "ДВП 4"],
      partsForQuality: [{ name: "Стійка", qty: 2, size: "720x560", material: "ДСП 18" }],
      sourceMeta: {
        parsedPackage: true,
        extractionQuality: "good",
        partsCount: 42,
        materialsCount: 3,
        hardwareCount: 15,
        sourceType: "package_db+project+enver3"
      }
    });

    assert.ok(analysis.quality);
    assert.ok(analysis.quality.score >= 0.7);
    assert.ok(
      analysis.quality.reasons.some((r) => /розібраний пакет/i.test(r)),
      "має бути примітка про розібраний пакет"
    );
    assert.equal(analysis.quality.needsHumanReview, false);
    assert.equal(analysis.quality.safeToCreateTasks, true);
  });
});
