import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { panelForGodmodeAction } from "../../shared/production/godmode-ui-helpers.js";

describe("godmode navigation contracts", () => {
  it("конструктивні дії не мапляться на drawer «Ще»", () => {
    assert.equal(panelForGodmodeAction("run_ai_analysis"), "constructive");
    assert.equal(panelForGodmodeAction("create_tasks_from_ai"), "constructive");
    assert.notEqual(panelForGodmodeAction("resolve_problem"), "constructive");
  });
});
