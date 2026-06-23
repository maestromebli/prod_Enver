import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyStageHandoff } from "../src/position-logic.js";
import { applyOrderStatusPreset, orderStatusStagePreset } from "../src/order-status-workflow.js";

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
      { cutting_status: "Не розпочато", edging_status: "Не розпочато" },
      preset
    );
    assert.equal(row.cutting_status, "Передано");
    assert.equal(row.edging_status, "Не розпочато");
  });
});
