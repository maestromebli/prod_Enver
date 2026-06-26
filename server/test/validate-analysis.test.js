import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRawAnalysisContent, parseAiJsonContent } from "../src/ai/validate-analysis.js";

describe("validate-analysis parseRaw", () => {
  it("parseAiJsonContent — not_object для масиву", () => {
    const r = parseAiJsonContent("[1,2]");
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_object");
  });

  it("parseRawAnalysisContent — fallback для порожнього", () => {
    const r = parseRawAnalysisContent("");
    assert.equal(r.parseFailed, true);
    assert.ok(r.raw.warnings?.length);
  });

  it("parseRawAnalysisContent — текст замість JSON", () => {
    const r = parseRawAnalysisContent("Це звичайний текст від моделі без JSON");
    assert.equal(r.parseFailed, true);
    assert.match(r.raw.summary, /текст/);
  });

  it("parseRawAnalysisContent — валідний JSON", () => {
    const r = parseRawAnalysisContent('{"summary":"ok","materials":[]}');
    assert.equal(r.parseFailed, false);
    assert.equal(r.raw.summary, "ok");
  });
});
