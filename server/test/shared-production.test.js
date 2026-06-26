import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStageHandoff,
  computeProgress,
  deriveCurrentStage,
  enrichPositionRow,
  PRODUCTION_PROGRESS_WEIGHTS
} from "../../shared/production/position-logic.js";
import {
  OPERATOR_QUEUE_STATUSES,
  OPERATOR_SESSION_ACTIVE_STATUSES_LIST,
  STAGE_STATUSES
} from "../../shared/production/stages.js";
import { parseUaDate } from "../../shared/dates/ua-date.js";

describe("shared/production", () => {
  it("ваги етапів = 100%", () => {
    const sum = Object.values(PRODUCTION_PROGRESS_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
  });

  it("STAGE_STATUSES містить усі робочі стани", () => {
    assert.ok(STAGE_STATUSES.includes("В роботі"));
    assert.ok(STAGE_STATUSES.includes("Передано"));
  });

  it("набори статусів узгоджені", () => {
    assert.ok(OPERATOR_QUEUE_STATUSES.includes("Передано"));
    assert.deepEqual(OPERATOR_SESSION_ACTIVE_STATUSES_LIST.sort(), ["В роботі", "На паузі"].sort());
  });

  it("parseUaDate підтримує UA та ISO", () => {
    const ua = parseUaDate("15.06.2026");
    assert.equal(ua?.getDate(), 15);
    const iso = parseUaDate("2026-06-15");
    assert.equal(iso?.getMonth(), 5);
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
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "В роботі",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато"
    };
    assert.equal(deriveCurrentStage(row), "edging");
  });

  it("deriveCurrentStage без файлу — етап constructor", () => {
    const row = {
      has_constructive_file: false,
      constructor_name: "Ігор",
      cutting_status: "Не розпочато",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато"
    };
    assert.equal(deriveCurrentStage(row), "constructor");
  });

  it("enrichPositionRow додає progress і current_stage", () => {
    const enriched = enrichPositionRow({
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      constructor_name: "",
      problem: "",
      position_status: "",
      overdue_days: 0
    });
    assert.equal(enriched.progress, 25);
    assert.equal(enriched.current_stage, "edging");
    assert.equal(computeProgress(enriched), 25);
  });
});
