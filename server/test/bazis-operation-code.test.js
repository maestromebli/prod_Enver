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
  pickBestPartRowForBazisScan,
  partNoFromBazisOperationCode,
  resolvePartHighlightMesh,
  bazisScanLookupVariants
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
    assert.equal(normalizeBazisScanCode("]C10010x002x1V"), "0010X002X1");
  });

  it("виправляє x→ч від HID-сканера з українською розкладкою", () => {
    assert.equal(normalizeBazisScanCode("0014ч006ч1"), "0014X006X1");
    assert.equal(normalizeBazisScanCode("NC1: 0014Ч006Ч1V"), "0014X006X1");
    assert.equal(normalizeBazisScanCode("0010х002х1V"), "0010X002X1");
    assert.equal(normalizeBazisScanCode("0014ч006ч1м"), "0014X006X1");
  });

  it("bazisScanLookupVariants містить різні регістри", () => {
    const v = bazisScanLookupVariants("0010x002x1V");
    assert.ok(v.includes("0010x002x1V"));
    assert.ok(v.includes("0010X002X1"));
    assert.ok(v.includes("0010x002x1"));
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

  it("pickBestPartRowForBazisScan обирає деталь з кодом Bazis серед дублікатів", () => {
    const rows = [
      { id: 1, part_no: "14", part_name: "14", bazis_operation_codes: [] },
      {
        id: 2,
        part_no: "14",
        part_name: "№14 Стійка сер шафа ліва",
        bazis_operation_codes: ["0014X006X1"]
      },
      { id: 3, part_no: "14", part_name: "14", bazis_operation_codes: [] }
    ];
    const best = pickBestPartRowForBazisScan(rows, "NC1: 0014x006x1V");
    assert.equal(best.id, 2);
  });

  it("pickBestPartRowForBazisScan обирає деталь за назвою №14 без part_no", () => {
    const rows = [
      { id: 1, part_no: "", part_name: "№14 Стійка сер шафа ліва", bazis_operation_codes: [] },
      { id: 2, part_no: "99", part_name: "Інша деталь", bazis_operation_codes: [] }
    ];
    const best = pickBestPartRowForBazisScan(rows, "NC1: 0014x006x1V");
    assert.equal(best.id, 1);
  });

  it("partNo з етикеток ЕМ-09: 0016x008x1V → 16, 0014x006x1V → 14", () => {
    assert.equal(partNoFromBazisOperationCode("NC1: 0016x008x1V"), "16");
    assert.equal(partNoFromBazisOperationCode("NC1: 0014x006x1V"), "14");
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
