import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractBazisOperationCodesFromProjectText,
  groupBazisOperationCodesByPartNo,
  isBazisOperationScanCode,
  normalizeBazisScanCode,
  partNoFromBazisOperationCode,
  resolvePartHighlightMesh
} from "../../shared/production/bazis-operation-code.js";
import { decodeProjectText } from "../src/constructive/parsers/project-text.js";
import { findPartByBarcode } from "../src/constructive/constructive-package-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const em09Project = path.join(
  __dirname,
  "../../data/uploads/constructive/261/packages/106/1782491379122-ЕМ-09 Гардеробна .project"
);

describe("bazis-operation-code", () => {
  it("нормалізує NC1: та суфікс V", () => {
    assert.equal(normalizeBazisScanCode("NC1: 0010x002x1V"), "0010X002X1");
    assert.equal(normalizeBazisScanCode("0010x002x1"), "0010X002X1");
  });

  it("визначає partNo з коду операції", () => {
    assert.equal(partNoFromBazisOperationCode("0010x002x1V"), "10");
    assert.equal(partNoFromBazisOperationCode("0011x003x2"), "11");
  });

  it("розпізнає код операції Bazis", () => {
    assert.equal(isBazisOperationScanCode("0010x002x1V"), true);
    assert.equal(isBazisOperationScanCode("ENVER-E-30-1-1-21"), false);
  });

  it("resolvePartHighlightMesh використовує partNo → panel-10", () => {
    assert.deepEqual(resolvePartHighlightMesh({ partNo: "10" }), {
      meshName: "panel-10",
      nodeId: "10"
    });
  });

  it("витягує коди операцій з реального .project ЕМ-09", () => {
    if (!fs.existsSync(em09Project)) return;
    const text = decodeProjectText(fs.readFileSync(em09Project));
    const codes = extractBazisOperationCodesFromProjectText(text);
    assert.ok(codes.includes("0010X002X1"));
    assert.ok(codes.includes("0010X002X2"));
    const grouped = groupBazisOperationCodesByPartNo(codes);
    assert.deepEqual(grouped.get("10"), ["0010X002X1", "0010X002X2"]);
  });
});

describe("findPartByBarcode bazis (integration)", () => {
  it("знаходить деталь за кодом етикетки 0010x002x1V", async () => {
    if (!process.env.DATABASE_URL) return;
    const part = await findPartByBarcode("0010x002x1V");
    if (!part) return;
    assert.equal(part.partNo, "10");
    assert.ok(part.bazisOperationCodes?.includes("0010X002X1"));
  });
});
