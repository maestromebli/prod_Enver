import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGiblabText, mergeGiblabSummary } from "../src/giblab-parser.js";

describe("giblab-parser", () => {
  it("витягує кількість деталей і матеріал", () => {
    const text = "material: ДСП 18 W960\nquantity: 48\ncut length: 12500 mm";
    const summary = parseGiblabText(text, "kitchen.gib");
    assert.ok(summary.piecesTotal >= 48 || summary.cutLengthMm > 0);
    assert.ok(summary.materials.length >= 1);
  });

  it("mergeGiblabSummary об'єднує meta та парсер", () => {
    const merged = mergeGiblabSummary(
      { orderNumber: "EN-1", object: "Кухня", material: "ДСП" },
      { piecesTotal: 10 },
      { cutLengthMm: 5000 }
    );
    assert.equal(merged.orderNumber, "EN-1");
    assert.equal(merged.piecesTotal, 10);
    assert.equal(merged.cutLengthMm, 5000);
  });
});
