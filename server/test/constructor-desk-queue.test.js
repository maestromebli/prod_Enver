import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichPositionRow } from "../src/position-logic.js";
import { defaultWorkspacePayload } from "../src/constructor-desk-service.js";

describe("constructor desk queue (unit helpers)", () => {
  it("enrichPositionRow без конструктива — етап constructor", () => {
    const row = enrichPositionRow(
      {
        has_constructive_file: false,
        cutting_status: "Не розпочато",
        edging_status: "Не розпочато",
        drilling_status: "Не розпочато",
        assembly_status: "Не розпочато",
        packaging_status: "Не розпочато"
      },
      {}
    );
    assert.equal(row.current_stage, "constructor");
  });

  it("defaultWorkspacePayload для кухні", () => {
    const ws = defaultWorkspacePayload({ item: "Кухня E-30", item_type: "Зона" });
    assert.equal(ws.isKitchen, true);
  });
});

describe("constructor desk store grouping", () => {
  it("pendingCount рахує позиції без призначення", async () => {
    const { groupDeskPositionsIntoOrders } = await import("../src/constructor-desk-store.js");
    const orders = groupDeskPositionsIntoOrders([
      { orderId: 1, orderNumber: "E-1", constructorUserId: null, completion: { percent: 0 } },
      { orderId: 1, orderNumber: "E-1", constructorUserId: 2, completion: { percent: 10 } }
    ]);
    assert.equal(orders[0].pendingCount, 1);
    assert.equal(orders[0].assignedCount, 1);
  });
});
