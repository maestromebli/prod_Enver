import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyVisionToExtractionMeta, shouldUsePdfVision } from "../src/ai/pdf-vision.js";
import {
  buildVisionUserContent,
  resolveVisionModel,
  supportsVisionModel
} from "../src/ai/vision-messages.js";

describe("pdf-vision", () => {
  it("shouldUsePdfVision для poor/partial PDF", () => {
    assert.equal(
      shouldUsePdfVision({ sourceType: "pdf", extractionQuality: "poor" }, { usePdfVision: true }),
      true
    );
    assert.equal(
      shouldUsePdfVision({ sourceType: "pdf", extractionQuality: "good" }, { usePdfVision: true }),
      false
    );
    assert.equal(
      shouldUsePdfVision({ sourceType: "pdf", extractionQuality: "poor" }, { usePdfVision: false }),
      false
    );
  });

  it("applyVisionToExtractionMeta покращує якість", () => {
    const meta = applyVisionToExtractionMeta(
      { sourceType: "pdf", extractionQuality: "poor", warnings: ["PDF розпізнано частково"] },
      { images: [{ mime: "image/jpeg", base64: "abc" }], warnings: [] }
    );
    assert.equal(meta.extractionQuality, "partial");
    assert.equal(meta.visionUsed, true);
    assert.equal(meta.visionPageCount, 1);
    assert.ok(meta.warnings.some((w) => /vision/i.test(w)));
  });
});

describe("vision-messages", () => {
  it("supportsVisionModel", () => {
    assert.equal(supportsVisionModel("gpt-4o-mini"), true);
    assert.equal(supportsVisionModel("gpt-3.5-turbo"), false);
  });

  it("resolveVisionModel fallback", () => {
    assert.equal(resolveVisionModel({ openaiModel: "gpt-3.5-turbo" }), "gpt-4o-mini");
    assert.equal(resolveVisionModel({ openaiModel: "gpt-4o" }), "gpt-4o");
  });

  it("buildVisionUserContent з зображеннями", () => {
    const content = buildVisionUserContent("prompt", [{ base64: "abc123" }]);
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.equal(content[0].type, "text");
    assert.equal(content[1].type, "image_url");
  });
});
