import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MATERIAL_LIBRARY_SEED,
  mapMaterialLibraryRow,
  normalizeMaterialLibraryInput,
  procurementFieldsFromLibraryItem
} from "../../shared/production/material-library.js";

describe("material library", () => {
  it("normalizeMaterialLibraryInput — назва обовʼязкова", () => {
    const bad = normalizeMaterialLibraryInput({ name: "  " });
    assert.equal(bad.ok, false);
    const ok = normalizeMaterialLibraryInput({ name: "ДСП 18", itemType: "board" });
    assert.equal(ok.ok, true);
    assert.equal(ok.row.name, "ДСП 18");
    assert.equal(ok.row.item_type, "board");
  });

  it("DEFAULT_MATERIAL_LIBRARY_SEED — усі записи валідні", () => {
    for (const item of DEFAULT_MATERIAL_LIBRARY_SEED) {
      const r = normalizeMaterialLibraryInput(item);
      assert.equal(r.ok, true, item.name);
    }
    assert.ok(DEFAULT_MATERIAL_LIBRARY_SEED.length >= 5);
  });

  it("mapMaterialLibraryRow і procurementFieldsFromLibraryItem", () => {
    const mapped = mapMaterialLibraryRow({
      id: 1,
      name: "Петля",
      article: "X1",
      item_type: "hardware",
      category: "",
      material: "",
      thickness: "",
      decor: "",
      unit: "шт",
      supplier: "Blum",
      estimated_price: 12.5,
      notes: "",
      active: true
    });
    const fields = procurementFieldsFromLibraryItem(mapped);
    assert.equal(fields.name, "Петля");
    assert.equal(fields.supplier, "Blum");
    assert.equal(fields.materialLibraryId, 1);
  });
});
