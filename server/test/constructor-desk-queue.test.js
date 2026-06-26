import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichPositionRow } from "../src/position-logic.js";
import { defaultWorkspacePayload } from "../src/constructor-desk-service.js";
import { shouldEnqueuePositionForConstructorDesk } from "../src/constructor-desk-queue.js";

describe("constructor desk queue (unit helpers)", () => {
  it("enrichPositionRow без конструктива — етап constructor", () => {
    const row = enrichPositionRow(
      {
        has_constructive_file: false,
        cutting_status: "Не розпочато",
        edging_status: "Не розпочато",
        drilling_status: "Не розпочато",
        assembly_status: "Не розпочато"
      },
      {}
    );
    assert.equal(row.current_stage, "constructor");
  });

  it("defaultWorkspacePayload для кухні", () => {
    const ws = defaultWorkspacePayload({ item: "Кухня E-30", item_type: "Зона" });
    assert.equal(ws.isKitchen, true);
  });

  it("shouldEnqueuePositionForConstructorDesk — пропускає вже передані в цех", () => {
    assert.equal(
      shouldEnqueuePositionForConstructorDesk({
        id: 1,
        has_constructive_file: true,
        cutting_status: "Передано"
      }),
      false
    );
    assert.equal(
      shouldEnqueuePositionForConstructorDesk({
        id: 2,
        has_constructive_file: false,
        cutting_status: "Не розпочато"
      }),
      true
    );
    assert.equal(
      shouldEnqueuePositionForConstructorDesk({
        id: 3,
        constructor_desk_queued_at: "2026-01-01"
      }),
      true
    );
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
