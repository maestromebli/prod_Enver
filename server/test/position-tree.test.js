import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVisiblePositionRows } from "../../client/src/position-tree.js";

describe("position tree", () => {
  it("групує підпозиції під основною і сортує замовлення за номером", () => {
    const all = [
      { id: 2, orderNumber: "B-1", parentId: null, item: "B root" },
      { id: 3, orderNumber: "B-1", parentId: 2, item: "B sub" },
      { id: 1, orderNumber: "A-1", parentId: null, item: "A root" },
      { id: 4, orderNumber: "A-1", parentId: 1, item: "A sub" }
    ];
    const expanded = new Set([1, 2]);
    const rows = buildVisiblePositionRows(all, all, expanded);

    assert.deepEqual(
      rows.map((r) => r.position.id),
      [1, 4, 2, 3]
    );
    assert.deepEqual(
      rows.filter((r) => r.isSub).map((r) => r.position.item),
      ["A sub", "B sub"]
    );
  });
});
