import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { parseXlsBuffer } from "../src/constructive/parsers/xls-parser.js";

async function buildSpecXlsx() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Spec");
  sheet.addRow(["Матеріал", "Код", "Товщина", "Лист", "К-сть", "Од"]);
  sheet.addRow(["ДСП білий", "W980", "18 мм", "2800x2070", "2", "лист"]);
  sheet.addRow(["МДФ", "M001", "16 мм", "2800x2070", "1", "лист"]);
  sheet.addRow(["Фурнітура", "Артикул", "К-сть", "Од", "", ""]);
  sheet.addRow(["Петля", "H123", "4", "шт", "", ""]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("xls-parser", () => {
  it("legacy .xls — підказка конвертувати в .xlsx", async () => {
    const r = await parseXlsBuffer(Buffer.from("fake"), "spec.xls");
    assert.equal(r.materials.length, 0);
    assert.match(r.warnings[0], /\.xlsx/);
  });

  it("парсить .xlsx через exceljs", async () => {
    const buffer = await buildSpecXlsx();
    const r = await parseXlsBuffer(buffer, "spec.xlsx");
    assert.ok(r.materials.length >= 1);
    assert.ok(r.hardware.length >= 1);
    assert.equal(r.extractionQuality, "good");
  });
});
