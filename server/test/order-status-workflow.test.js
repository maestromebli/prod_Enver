import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStageHandoff } from "../src/position-logic.js";
import {
  applyOrderStatusPreset,
  defaultPositionRow,
  defaultSubPositionRow,
  orderPositionFieldsFromOrder,
  normalizeOrderSubItems,
  orderStatusStagePreset,
  positionStagesChanged
} from "../src/order-status-workflow.js";

describe("applyStageHandoff", () => {
  it("після «Готово» на порізці передає крайкування", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато"
    };
    const next = applyStageHandoff(row, "cutting", { status: "Готово" });
    assert.equal(next.edging_status, "Передано");
  });

  it("файл конструктива завантажено — передає порізку", () => {
    const row = {
      has_constructive_file: true,
      constructor_name: "Ігор",
      cutting_status: "Не розпочато"
    };
    const next = applyStageHandoff(row, "constructor", { status: "Передано" });
    assert.equal(next.cutting_status, "Передано");
  });

  it("не перезаписує вже активний наступний етап", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "В роботі"
    };
    const next = applyStageHandoff(row, "cutting", { status: "Готово" });
    assert.equal(next.edging_status, "В роботі");
  });
});

describe("orderStatusStagePreset", () => {
  it("«Передано у виробництво» відкриває порізку", () => {
    const preset = orderStatusStagePreset("Передано у виробництво");
    const row = applyOrderStatusPreset(
      {
        has_constructive_file: true,
        cutting_status: "Не розпочато",
        edging_status: "Не розпочато"
      },
      preset
    );
    assert.equal(row.cutting_status, "Передано");
    assert.equal(row.edging_status, "Не розпочато");
  });

  it("без конструктива порізку не відкриває", () => {
    const preset = orderStatusStagePreset("Передано у виробництво");
    const row = applyOrderStatusPreset(
      { cutting_status: "Не розпочато", edging_status: "Не розпочато" },
      preset
    );
    assert.equal(row.cutting_status, "Не розпочато");
  });

  it("«У виробництві» також відкриває порізку", () => {
    const preset = orderStatusStagePreset("У виробництві");
    assert.deepEqual(preset, { cutting_status: "Передано" });
  });

  it("невідомий статус — порожній preset", () => {
    assert.deepEqual(orderStatusStagePreset("Закрито"), {});
    assert.deepEqual(applyOrderStatusPreset({ cutting_status: "Готово" }, {}), {
      cutting_status: "Готово"
    });
  });
});

describe("positionStagesChanged", () => {
  it("виявляє зміну етапу", () => {
    const before = {
      cutting_status: "Очікує",
      edging_status: "Очікує",
      drilling_status: "Очікує",
      assembly_status: "Очікує"
    };
    const after = { ...before, cutting_status: "В роботі" };
    assert.equal(positionStagesChanged(before, after), true);
    assert.equal(positionStagesChanged(before, before), false);
  });
});

describe("orderPositionFieldsFromOrder", () => {
  it("копіює адресу, клієнта, коментар і план з замовлення", () => {
    const fields = orderPositionFieldsFromOrder({
      default_delivery_address: "вул. Тестова 1",
      client: "Іван Петренко",
      comment: "Терміново",
      plan_date: "30.06.2026"
    });
    assert.equal(fields.delivery_address, "вул. Тестова 1");
    assert.equal(fields.delivery_contact_name, "Іван Петренко");
    assert.equal(fields.note, "Терміново");
    assert.equal(fields.position_deadline, "30.06.2026");
  });
});

describe("defaultPositionRow", () => {
  it("містить has_constructive_file для INSERT", () => {
    const row = defaultPositionRow({ id: 1, order_number: "T-1", object: "Об'єкт" }, 10);
    assert.equal(row.packaging_status, "Не потрібно");
    assert.equal(row.has_constructive_file, false);

    const full = defaultPositionRow(
      {
        id: 1,
        order_number: "T-2",
        object: "ЖК Ліпінка",
        manager: "Олег",
        default_delivery_address: "вул. 1",
        client: "Клієнт",
        comment: "Примітка",
        plan_date: "01.07.2026"
      },
      20
    );
    assert.equal(full.delivery_address, "вул. 1");
    assert.equal(full.delivery_contact_name, "Клієнт");
    assert.equal(full.note, "Примітка");
    assert.equal(full.position_deadline, "01.07.2026");

    const sub = defaultSubPositionRow(
      { id: 1, order_number: "T-1", object: "ЖК Ліпінка" },
      { id: 10 },
      11,
      "Кухня"
    );
    assert.equal(sub.parent_id, 10);
    assert.equal(sub.item, "Кухня");
    assert.equal(sub.item_type, "Зона");

    assert.deepEqual(normalizeOrderSubItems({ subItems: ["кухня", "  кухня ", "", "Вітальня"] }), [
      "кухня",
      "Вітальня"
    ]);
  });
});
