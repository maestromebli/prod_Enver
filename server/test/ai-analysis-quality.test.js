import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAnalysisQuality } from "../src/ai/analysis-quality.js";
import { normalizeAnalysisResult } from "../src/ai/normalize-analysis.js";

function baseAnalysis(overrides = {}) {
  return normalizeAnalysisResult({
    summary: "Шафа-купе 2400",
    materials: ["ДСП 18"],
    panels: [{ name: "Бік", qty: 2, size: "2400x600" }],
    suggestedTasks: [
      { stage: "cutting", needed: true, reason: "панелі", confidence: 0.85 },
      { stage: "edging", needed: true, reason: "видимі торці", confidence: 0.9 }
    ],
    estimatedComplexity: "medium",
    ...overrides
  });
}

describe("computeAnalysisQuality", () => {
  it("низька якість без задач і матеріалів", () => {
    const analysis = normalizeAnalysisResult({ summary: "лише текст" });
    const q = computeAnalysisQuality(analysis, { extractionQuality: "good" });
    assert.ok(q.score < 0.5);
    assert.equal(q.needsHumanReview, true);
    assert.equal(q.safeToCreateTasks, false);
  });

  it("missingInfo вимагає human review", () => {
    const analysis = baseAnalysis({ missingInfo: ["фурнітура"] });
    const q = computeAnalysisQuality(analysis, { extractionQuality: "good" });
    assert.equal(q.needsHumanReview, true);
    assert.ok(q.reasons.some((r) => /бракує даних/i.test(r)));
  });

  it("partial extraction вимагає перевірки", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(analysis, {
      extractionQuality: "partial",
      sourceType: "pdf"
    });
    assert.equal(q.needsHumanReview, true);
    assert.ok(q.reasons.some((r) => /частково/i.test(r)));
  });

  it("safeToCreateTasks при confidence >= 0.8 і без проблем", () => {
    const analysis = baseAnalysis({
      suggestedTasks: [
        { stage: "cutting", needed: true, reason: "a", confidence: 0.9 },
        { stage: "edging", needed: true, reason: "b", confidence: 0.85 }
      ]
    });
    const q = computeAnalysisQuality(analysis, { extractionQuality: "good" });
    assert.equal(q.safeToCreateTasks, true);
    assert.ok(q.reasons.some((r) => /підтвердження/i.test(r)));
  });

  it("низька confidence блокує safeToCreateTasks", () => {
    const analysis = baseAnalysis({
      suggestedTasks: [{ stage: "cutting", needed: true, reason: "a", confidence: 0.5 }]
    });
    const q = computeAnalysisQuality(analysis, { extractionQuality: "good" });
    assert.equal(q.safeToCreateTasks, false);
    assert.ok(q.reasons.some((r) => /впевненість/i.test(r)));
  });

  it("враховує схожі замовлення ENVER", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(
      analysis,
      { extractionQuality: "good" },
      {
        examples: [{ lesson: "додавали drilling" }, { lesson: "перевіряли крайку" }],
        summary: "test"
      }
    );
    assert.ok(q.reasons.some((r) => /схожі замовлення/i.test(r)));
  });

  it("часті помилки AI знижують довіру", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(
      analysis,
      { extractionQuality: "good" },
      {
        frequentMistakeCount: 3
      }
    );
    assert.equal(q.needsHumanReview, true);
    assert.ok(q.reasons.some((r) => /часто помилявся/i.test(r)));
  });

  it("суперечливий досвід вимагає перевірки", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(
      analysis,
      { extractionQuality: "good" },
      {
        conflicting: true
      }
    );
    assert.equal(q.needsHumanReview, true);
    assert.ok(q.reasons.some((r) => /суперечливий/i.test(r)));
  });

  it("admin rule додає reason", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(
      analysis,
      { extractionQuality: "good" },
      {
        rules: [{ title: "перевірити drilling для шаф", rule_text: "..." }]
      }
    );
    assert.ok(q.reasons.some((r) => /правило ENVER/i.test(r)));
  });

  it("DWG дає poor quality і human review", () => {
    const analysis = baseAnalysis();
    const q = computeAnalysisQuality(analysis, {
      sourceType: "dwg",
      extractionQuality: "poor"
    });
    assert.equal(q.needsHumanReview, true);
    assert.ok(q.reasons.some((r) => /DWG/i.test(r)));
  });
});
