import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProgress,
  derivePositionStatus,
  PRODUCTION_PROGRESS_WEIGHTS
} from "../src/position-logic.js";

describe("computeProgress", () => {
  it("ваги етапів виробництва дають у сумі 100%", () => {
    const sum = Object.values(PRODUCTION_PROGRESS_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  it("100% лише коли всі п'ять етапів виробництва готові", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "Готово",
      drilling_status: "Готово",
      assembly_status: "Готово",
      packaging_status: "Готово",
      constructor_name: ""
    };
    assert.equal(computeProgress(row), 100);
  });

  it("лише порізка готова — 18%", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато"
    };
    assert.equal(computeProgress(row), 18);
  });

  it("позиція лише на паузі на етапі — «У виробництві»", () => {
    const row = {
      cutting_status: "На паузі",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      constructor_name: "",
      problem: "",
      position_status: ""
    };
    assert.equal(derivePositionStatus(row), "У виробництві");
  });

  it("конструктив не впливає на прогрес", () => {
    const without = {
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      constructor_name: ""
    };
    const withConstructor = { ...without, constructor_name: "Іван" };
    assert.equal(computeProgress(without), computeProgress(withConstructor));
  });
});
