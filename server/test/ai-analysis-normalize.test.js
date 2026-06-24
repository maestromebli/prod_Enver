import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAnalysisResult } from "../src/ai/normalize-analysis.js";
import { parseAiJsonContent } from "../src/ai/validate-analysis.js";

describe("normalizeAnalysisResult", () => {
  it("гарантує всі поля для порожнього вводу", () => {
    const r = normalizeAnalysisResult(null);
    assert.equal(typeof r.summary, "string");
    assert.ok(Array.isArray(r.materials));
    assert.ok(Array.isArray(r.panels));
    assert.ok(Array.isArray(r.warnings));
    assert.ok(Array.isArray(r.suggestedTasks));
    assert.ok(["low", "medium", "high"].includes(r.estimatedComplexity));
    assert.ok(r.operatorNotes.cutting !== undefined);
    assert.ok(r.quality);
  });

  it("нормалізує materials до масиву рядків", () => {
    const r = normalizeAnalysisResult({ materials: "ДСП 18", panels: [] });
    assert.deepEqual(r.materials, ["ДСП 18"]);
    const r2 = normalizeAnalysisResult({ materials: [{ name: "МДФ" }] });
    assert.deepEqual(r2.materials, ["МДФ"]);
  });

  it("видаляє дублі suggestedTasks", () => {
    const r = normalizeAnalysisResult({
      suggestedTasks: [
        { stage: "cutting", needed: true, reason: "a", confidence: 0.9 },
        { stage: "cutting", needed: true, reason: "b", confidence: 0.8 }
      ]
    });
    assert.equal(r.suggestedTasks.length, 1);
  });

  it("нормалізує confidence 0..1, default 0.6", () => {
    const r = normalizeAnalysisResult({
      suggestedTasks: [{ stage: "edging", needed: true, reason: "x" }]
    });
    assert.equal(r.suggestedTasks[0].confidence, 0.6);

    const r2 = normalizeAnalysisResult({
      suggestedTasks: [{ stage: "edging", needed: true, reason: "x", confidence: 1.5 }]
    });
    assert.equal(r2.suggestedTasks[0].confidence, 1);
  });

  it("невідомий stage переносить у warnings", () => {
    const r = normalizeAnalysisResult({
      suggestedTasks: [{ stage: "painting", needed: true, reason: "x", confidence: 0.9 }]
    });
    assert.equal(r.suggestedTasks.length, 0);
    assert.ok(r.warnings.some((w) => /невідомий етап/i.test(w)));
  });

  it("підтримує українські назви етапів", () => {
    const r = normalizeAnalysisResult({
      suggestedTasks: ["порізка", "присадка"]
    });
    assert.deepEqual(
      r.suggestedTasks.map((t) => t.stage),
      ["cutting", "drilling"]
    );
  });

  it("видаляє порожні warnings", () => {
    const r = normalizeAnalysisResult({
      summary: "тест",
      warnings: ["ok", "", "  "]
    });
    assert.deepEqual(r.warnings, ["ok"]);
  });
});

describe("parseAiJsonContent", () => {
  it("парсить markdown JSON", () => {
    const { ok, data } = parseAiJsonContent('```json\n{"summary":"test"}\n```');
    assert.equal(ok, true);
    assert.equal(data.summary, "test");
  });

  it("повертає помилку для поганого JSON", () => {
    const { ok } = parseAiJsonContent("not json at all");
    assert.equal(ok, false);
  });
});
