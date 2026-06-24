import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupDeskPositionsIntoOrders,
  isPositionOnConstructorDesk
} from "../src/constructor-desk-store.js";

describe("constructor desk store", () => {
  it("isPositionOnConstructorDesk — етап constructor або призначення", () => {
    assert.equal(isPositionOnConstructorDesk({ current_stage: "constructor" }), true);
    assert.equal(isPositionOnConstructorDesk({ constructor_user_id: 3 }), true);
    assert.equal(isPositionOnConstructorDesk({ constructor_name: "Іван" }), true);
    assert.equal(isPositionOnConstructorDesk({ current_stage: "cutting" }), false);
  });

  it("groupDeskPositionsIntoOrders групує позиції за замовленням", () => {
    const orders = groupDeskPositionsIntoOrders([
      {
        orderId: 1,
        orderNumber: "E-10",
        object: "Об'єкт",
        orderClient: "Клієнт",
        completion: { percent: 40 },
        constructorUserId: 2
      },
      {
        orderId: 1,
        orderNumber: "E-10",
        object: "Об'єкт",
        orderClient: "Клієнт",
        completion: { percent: 80 }
      },
      {
        orderId: 2,
        orderNumber: "E-11",
        object: "Інший",
        completion: { percent: 10 }
      }
    ]);
    assert.equal(orders.length, 2);
    assert.equal(orders[0].orderNumber, "E-10");
    assert.equal(orders[0].positionCount, 2);
    assert.equal(orders[0].assignedCount, 1);
    assert.equal(orders[0].maxCompletionPercent, 80);
  });
});
