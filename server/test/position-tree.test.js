import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVisiblePositionRows } from "../../client/src/position-tree.js";

describe("position tree", () => {
  it("показує лише робочі підпозиції без службового контейнера", () => {
    const all = [
      { id: 2, orderNumber: "B-1", parentId: null, item: "B root", itemType: "Інше" },
      { id: 3, orderNumber: "B-1", parentId: 2, item: "B sub", itemType: "Зона" },
      { id: 1, orderNumber: "A-1", parentId: null, item: "A root", itemType: "Інше" },
      { id: 4, orderNumber: "A-1", parentId: 1, item: "A sub", itemType: "Зона" }
    ];
    const expanded = new Set([1, 2]);
    const rows = buildVisiblePositionRows(all, all, expanded);

    assert.deepEqual(
      rows.map((r) => r.position.id),
      [4, 3]
    );
    assert.equal(
      rows.every((r) => !r.isSub),
      true
    );
    assert.equal(
      rows.every((r) => r.depth === 0),
      true
    );
  });
});
