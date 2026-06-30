import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveOrderStatusFromPositions,
  shouldUpdateOrderStatus
} from "../../shared/production/order-status-from-positions.js";
import { applyOrderStatusPreset, orderStatusStagePreset } from "../src/order-status-workflow.js";

const order = { id: 1, orderNumber: "E-100" };

describe("deriveOrderStatusFromPositions", () => {
  it("усі позиції завершено → Завершено", () => {
    const positions = [
      { id: 1, orderId: 1, parentId: null, position_status: "Завершено" },
      { id: 2, orderId: 1, parentId: 1, position_status: "Завершено" }
    ];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "Завершено");
  });

  it("частина готова → Частково готово", () => {
    const positions = [
      { id: 10, orderId: 1, parentId: null, itemType: "Інше", position_status: "Не розпочато" },
      { id: 11, orderId: 1, parentId: 10, position_status: "Готово до встановлення" },
      { id: 12, orderId: 1, parentId: 10, position_status: "У виробництві" }
    ];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "Частково готово");
  });

  it("є проблема → Проблема", () => {
    const positions = [{ id: 1, orderId: 1, parentId: null, problem: "Немає матеріалу" }];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "Проблема");
  });

  it("монтаж заплановано → На встановленні", () => {
    const positions = [
      {
        id: 1,
        orderId: 1,
        parentId: null,
        position_status: "На встановленні",
        install_date: "01.07.2026"
      }
    ];
    assert.equal(deriveOrderStatusFromPositions(order, positions), "На встановленні");
  });
});

describe("shouldUpdateOrderStatus", () => {
  it("лише вперед по pipeline", () => {
    assert.equal(shouldUpdateOrderStatus("У виробництві", "Готово до встановлення"), true);
    assert.equal(shouldUpdateOrderStatus("Готово до встановлення", "У виробництві"), false);
  });

  it("не чіпає Пауза за клієнтом", () => {
    assert.equal(shouldUpdateOrderStatus("Пауза за клієнтом", "Завершено"), false);
  });
});

describe("applyOrderStatusPreset без конструктива", () => {
  it("не відкриває порізку без файлу", () => {
    const preset = orderStatusStagePreset("Передано у виробництво");
    const row = applyOrderStatusPreset(
      { cutting_status: "Не розпочато", has_constructive_file: false },
      preset
    );
    assert.equal(row.cutting_status, "Не розпочато");
  });

  it("відкриває порізку з конструктивом", () => {
    const preset = orderStatusStagePreset("Передано у виробництво");
    const row = applyOrderStatusPreset(
      { cutting_status: "Не розпочато", has_constructive_file: true },
      preset
    );
    assert.equal(row.cutting_status, "Передано");
  });
});
