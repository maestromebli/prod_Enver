import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectBlockers,
  collectWarnings,
  deriveNextAction,
  detectAutoHandoffs
} from "../../shared/production/next-action.js";
import { enrichPositionRow } from "../../shared/production/position-logic.js";

describe("next-action", () => {
  it("без конструктива — блокер upload", () => {
    const row = {
      has_constructive_file: false,
      cutting_status: "Не розпочато",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      problem: "",
      position_status: ""
    };
    const blockers = collectBlockers(row);
    assert.equal(blockers[0].code, "no_constructive");
    const next = deriveNextAction(row);
    assert.equal(next.type, "blocker");
  });

  it("прострочка — попередження", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "В роботі",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      overdue_days: 3,
      problem: "",
      position_status: "У виробництві"
    };
    const warnings = collectWarnings(row);
    assert.ok(warnings.some((w) => w.code === "overdue"));
  });

  it("наступна дія — завершити поточний етап", () => {
    const row = {
      has_constructive_file: true,
      cutting_status: "В роботі",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      assembly_responsible: "Петро",
      problem: "",
      position_status: "У виробництві"
    };
    const next = deriveNextAction(row);
    assert.equal(next.type, "advance");
    assert.equal(next.stageKey, "cutting");
    assert.equal(next.targetStatus, "Готово");
  });

  it("detectAutoHandoffs знаходить передачу на крайкування", () => {
    const before = {
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато"
    };
    const after = { ...before, edging_status: "Передано" };
    const handoffs = detectAutoHandoffs(before, after, "cutting");
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0].stageKey, "edging");
  });

  it("enrichPositionRow обчислює progress без legacy next_action", () => {
    const enriched = enrichPositionRow({
      has_constructive_file: true,
      cutting_status: "Передано",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      packaging_status: "Не розпочато",
      assembly_responsible: "Олег",
      problem: "",
      position_status: "",
      overdue_days: 0
    });
    assert.equal(enriched.progress > 0, true);
    assert.equal(enriched.current_stage, "cutting");
    assert.equal(enriched.next_action, undefined);
    assert.equal(enriched.warnings, undefined);
  });
});
