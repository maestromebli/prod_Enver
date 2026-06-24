import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONSTRUCTIVE_MAX_BYTES,
  constructiveFilesSummary,
  formatConstructiveSize,
  isConstructiveExtension
} from "../../shared/production/constructive-files.js";

describe("shared/production/constructive-files", () => {
  it("приймає типові розширення конструктивів", () => {
    assert.equal(isConstructiveExtension("креслення.pdf"), true);
    assert.equal(isConstructiveExtension("модель.b3d"), true);
    assert.equal(isConstructiveExtension("специфікація.xls"), true);
    assert.equal(isConstructiveExtension("readme.exe"), false);
  });

  it("formatConstructiveSize — людський розмір", () => {
    assert.equal(formatConstructiveSize(500), "500 Б");
    assert.match(formatConstructiveSize(2048), /КБ/);
    assert.match(formatConstructiveSize(CONSTRUCTIVE_MAX_BYTES), /МБ/);
  });

  it("constructiveFilesSummary — один або кілька файлів", () => {
    assert.equal(constructiveFilesSummary({ fileCount: 0 }), "");
    assert.equal(constructiveFilesSummary({ fileCount: 1, latestName: "a.pdf" }), "a.pdf");
    assert.equal(constructiveFilesSummary({ fileCount: 4, latestName: "a.pdf" }), "4 файли");
  });
});
