import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectBlockers,
  collectWarnings,
  deriveNextAction
} from "../../shared/production/next-action.js";

describe("next-action extended", () => {
  it("проблема на етапі — блокер problem", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "Проблема",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      problem: "Зламаний інструмент",
      position_status: "Проблема"
    };
    const blockers = collectBlockers(row);
    assert.ok(blockers.some((b) => b.code === "problem"));
  });

  it("всі етапи готові — advance assembly до Готово", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "Готово",
      drilling_status: "Готово",
      assembly_status: "В роботі",
      assembly_responsible: "Іван",
      problem: "",
      position_status: "У виробництві"
    };
    const next = deriveNextAction(row);
    assert.equal(next.type, "advance");
    assert.equal(next.stageKey, "assembly");
    assert.equal(next.targetStatus, "Готово");
  });

  it("пауза — попередження paused", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "На паузі",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      problem: "",
      position_status: "На паузі"
    };
    const warnings = collectWarnings(row);
    assert.ok(warnings.some((w) => w.code === "paused"));
  });
});
