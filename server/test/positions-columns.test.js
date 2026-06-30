import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePositionsColumnPreset,
  positionsColumnPresetClass,
  POSITIONS_COLUMN_PRESETS
} from "../../client/src/positions-columns.js";

describe("positions-columns", () => {
  it("normalizePositionsColumnPreset повертає manager для невідомого значення", () => {
    assert.equal(normalizePositionsColumnPreset("unknown"), "manager");
    assert.equal(normalizePositionsColumnPreset(null), "manager");
  });

  it("positionsColumnPresetClass додає модифікатор пресету", () => {
    assert.equal(positionsColumnPresetClass("floor"), "positions-view--cols-floor");
  });

  it("є три пресети колонок", () => {
    assert.equal(Object.keys(POSITIONS_COLUMN_PRESETS).length, 3);
  });
});
