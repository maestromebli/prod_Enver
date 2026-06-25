import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupDeskPositionsIntoOrders,
  isPositionOnConstructorDesk,
  filterUsersByConstructorDirectory
} from "../src/constructor-desk-store.js";
import {
  buildConstructorAssigneesFromDirectory,
  parseConstructorAssigneeValue
} from "../../shared/production/constructor-assignees.js";

describe("constructor desk store", () => {
  it("isPositionOnConstructorDesk — етап constructor або призначення", () => {
    assert.equal(isPositionOnConstructorDesk({ current_stage: "constructor" }), true);
    assert.equal(isPositionOnConstructorDesk({ constructor_desk_queued_at: "2026-01-01" }), true);
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
    assert.equal(orders[0].pendingCount, 1);
    assert.equal(orders[0].maxCompletionPercent, 80);
  });

  it("filterUsersByConstructorDirectory — лише імена з довідника", () => {
    const users = [
      { id: 1, name: "Ігор" },
      { id: 2, name: "Люда" },
      { id: 3, name: "  Олег  " }
    ];
    const filtered = filterUsersByConstructorDirectory(users, ["Ігор", "Олег", "Тарас"]);
    assert.deepEqual(
      filtered.map((u) => u.id),
      [1, 3]
    );
  });

  it("buildConstructorAssigneesFromDirectory — усі імена з довідника", () => {
    const users = [
      { id: 1, name: "Ігор", login: "igor", role: "operator" },
      { id: 2, name: "Люда", login: "lyuda", role: "manager" }
    ];
    const assignees = buildConstructorAssigneesFromDirectory(["Ігор", "Тарас", "Олег"], users);
    assert.deepEqual(assignees, [
      { id: 1, name: "Ігор", login: "igor", role: "operator" },
      { id: null, name: "Тарас", login: null, role: null },
      { id: null, name: "Олег", login: null, role: null }
    ]);
  });

  it("parseConstructorAssigneeValue — user і name", () => {
    assert.deepEqual(parseConstructorAssigneeValue("u:5"), {
      constructorUserId: 5,
      constructorName: ""
    });
    assert.deepEqual(parseConstructorAssigneeValue("n:Тарас"), {
      constructorUserId: null,
      constructorName: "Тарас"
    });
  });
});

describe("constructor assignees shared", () => {
  it("mergeConstructorAssignees підтягує довідник, якщо API порожній", async () => {
    const { mergeConstructorAssignees } =
      await import("../../shared/production/constructor-assignees.js");
    const merged = mergeConstructorAssignees([], ["Максим", "Тарас"]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].name, "Максим");
  });
});
