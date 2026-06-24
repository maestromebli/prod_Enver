import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNotifications,
  buildPositionGodmode,
  canRunNextAction,
  getAttentionScore,
  getPositionBlockers,
  getPositionNextAction,
  getPositionWarnings
} from "../../shared/production/godmode.js";

function basePosition(overrides = {}) {
  return {
    id: 1,
    order_number: "EN-102",
    orderNumber: "EN-102",
    item: "Шафа",
    has_constructive_file: false,
    cutting_status: "Не розпочато",
    edging_status: "Не розпочато",
    drilling_status: "Не розпочато",
    assembly_status: "Не розпочато",
    packaging_status: "Не розпочато",
    assembly_responsible: "Олег",
    problem: "",
    position_status: "Не розпочато",
    overdue_days: 0,
    ...overrides
  };
}

describe("godmode", () => {
  it("nextAction без конструктива — upload_constructive", () => {
    const next = getPositionNextAction(basePosition());
    assert.equal(next.type, "upload_constructive");
    assert.equal(next.label, "Завантажити конструктив");
  });

  it("nextAction з конструктивом без AI — run_ai_analysis", () => {
    const next = getPositionNextAction(basePosition({ has_constructive_file: true }), {
      hasAiAnalysis: false
    });
    assert.equal(next.type, "run_ai_analysis");
  });

  it("nextAction після AI без задач — create_tasks_from_ai", () => {
    const next = getPositionNextAction(basePosition({ has_constructive_file: true }), {
      hasAiAnalysis: true,
      tasksCreated: false
    });
    assert.equal(next.type, "create_tasks_from_ai");
  });

  it("handoff cutting → edging", () => {
    const next = getPositionNextAction(
      basePosition({
        has_constructive_file: true,
        cutting_status: "Готово",
        edging_status: "Не розпочато"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(next.type, "handoff_to_edging");
    assert.equal(next.stageKey, "edging");
  });

  it("handoff assembly → packaging", () => {
    const next = getPositionNextAction(
      basePosition({
        has_constructive_file: true,
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        packaging_status: "Не розпочато"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(next.type, "handoff_to_packaging");
  });

  it("ready for install", () => {
    const next = getPositionNextAction(
      basePosition({
        has_constructive_file: true,
        cutting_status: "Готово",
        edging_status: "Готово",
        drilling_status: "Готово",
        assembly_status: "Готово",
        packaging_status: "Готово",
        position_status: "Готово до встановлення"
      }),
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(next.type, "schedule_install");
  });

  it("overdue warning", () => {
    const warnings = getPositionWarnings(
      basePosition({
        has_constructive_file: true,
        cutting_status: "В роботі",
        overdue_days: 5
      })
    );
    assert.ok(warnings.some((w) => w.type === "overdue"));
  });

  it("blocker без конструктива", () => {
    const blockers = getPositionBlockers(basePosition());
    assert.ok(blockers.some((b) => b.type === "missing_constructive"));
  });

  it("notifications generation", () => {
    const positions = [
      basePosition({ id: 10, has_constructive_file: false }),
      basePosition({
        id: 11,
        has_constructive_file: true,
        cutting_status: "Готово",
        edging_status: "Не розпочато",
        hasAiAnalysis: true,
        tasksCreated: true
      })
    ];
    positions[1] = { ...positions[1] };
    const notes = buildNotifications({
      positions,
      orders: [],
      now: new Date("2026-06-24")
    });
    assert.ok(notes.some((n) => n.type === "missing_constructive" && n.entityId === 10));
    assert.ok(notes.length >= 2);
  });

  it("attentionScore sorting", () => {
    const low = getAttentionScore(basePosition(), [], []);
    const high = getAttentionScore(
      basePosition({ overdue_days: 3 }),
      [{ type: "overdue" }],
      [{ type: "missing_constructive" }]
    );
    assert.ok(high > low);
    const items = [
      { score: getAttentionScore(basePosition(), [], []) },
      {
        score: getAttentionScore(basePosition({ overdue_days: 5 }), [{ type: "overdue" }], [])
      }
    ].sort((a, b) => b.score - a.score);
    assert.ok(items[0].score >= 80);
  });

  it("operator cannot take second active task", () => {
    const check = canRunNextAction(
      basePosition({ has_constructive_file: true, cutting_status: "Передано" }),
      { type: "advance_stage", allowed: true },
      { role: "operator" },
      { operatorHasActiveTask: true }
    );
    assert.equal(check.allowed, false);
    assert.match(check.reason, /завершіть поточне/);
  });

  it("buildPositionGodmode повертає health та badges", () => {
    const gm = buildPositionGodmode(basePosition());
    assert.equal(gm.health, "blocked");
    assert.ok(gm.nextAction);
    assert.ok(Array.isArray(gm.badges));
    assert.ok(gm.attentionScore >= 50);
  });

  it("canRunNextAction для handoff — потребує прав production", () => {
    const pos = basePosition({
      has_constructive_file: true,
      cutting_status: "Готово",
      edging_status: "Не розпочато"
    });
    const prod = canRunNextAction(
      pos,
      { type: "handoff_to_edging" },
      { role: "production" },
      { hasAiAnalysis: true, tasksCreated: true }
    );
    assert.equal(prod.allowed, true);

    const op = canRunNextAction(pos, { type: "handoff_to_edging" }, { role: "operator" });
    assert.equal(op.allowed, false);
  });
});
