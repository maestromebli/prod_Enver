import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeOrders,
  activePositions,
  archivedOrders,
  archivedPositions,
  isArchivedPosition
} from "../../client/src/archive.js";

describe("archive selectors", () => {
  const orders = [
    { id: 1, orderNumber: "A-1", status: "У виробництві" },
    { id: 2, orderNumber: "A-2", status: "Завершено" }
  ];
  const positions = [
    { id: 10, orderId: 1, orderNumber: "A-1", positionStatus: "У виробництві" },
    { id: 11, orderId: 2, orderNumber: "A-2", positionStatus: "Готово до встановлення" },
    { id: 12, orderId: null, orderNumber: "X-1", positionStatus: "Завершено" }
  ];

  it("відокремлює активні та архівні замовлення", () => {
    assert.deepEqual(
      activeOrders(orders).map((o) => o.id),
      [1]
    );
    assert.deepEqual(
      archivedOrders(orders).map((o) => o.id),
      [2]
    );
  });

  it("позначає позиції архівними за статусом замовлення або позиції", () => {
    assert.equal(isArchivedPosition(positions[0], orders), false);
    assert.equal(isArchivedPosition(positions[1], orders), true);
    assert.equal(isArchivedPosition(positions[2], orders), true);
  });

  it("повертає лише активні позиції для робочих вкладок", () => {
    assert.deepEqual(
      activePositions(positions, orders).map((p) => p.id),
      [10]
    );
    assert.deepEqual(
      archivedPositions(positions, orders).map((p) => p.id),
      [11, 12]
    );
  });
});
