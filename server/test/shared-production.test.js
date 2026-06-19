import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStageHandoff,
  computeProgress,
  deriveCurrentStage,
  enrichPositionRow,
  PRODUCTION_PROGRESS_WEIGHTS
} from "../../shared/production/position-logic.js";
import { STAGE_STATUSES } from "../../shared/production/stages.js";

describe("shared/production", () => {
  it("ваги етапів = 100%", () => {
    const sum = Object.values(PRODUCTION_PROGRESS_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  it("STAGE_STATUSES містить усі робочі стани", () => {
    assert.ok(STAGE_STATUSES.includes("В роботі"));
    assert.ok(STAGE_STATUSES.includes("Передано"));
  });

  it("handoff cutting → edging", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато"
    };
    const next = applyStageHandoff(row, "cutting", { status: "Готово" });
    assert.equal(next.edging_status, "Передано");
  });

  it("deriveCurrentStage знаходить активний етап", () => {
    const row = {
      cutting_status: "Готово",
      edging_status: "В роботі",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато"
    };
    assert.equal(deriveCurrentStage(row), "edging");
  });

  it("enrichPositionRow додає progress і current_stage", () => {
    const enriched = enrichPositionRow({
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      constructor_name: "",
      problem: "",
      position_status: "",
      overdue_days: 0
    });
    assert.equal(enriched.progress, 20);
    assert.equal(enriched.current_stage, "edging");
    assert.equal(computeProgress(enriched), 20);
  });
});
