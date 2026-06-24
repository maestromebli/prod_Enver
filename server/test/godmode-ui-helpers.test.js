import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canQuickRunGodmodeAction,
  isRunnableGodmodeAction,
  panelForGodmodeAction
} from "../../shared/production/godmode-ui-helpers.js";

describe("godmode UI helpers", () => {
  it("panelForGodmodeAction — install та more", () => {
    assert.equal(panelForGodmodeAction("schedule_install"), "install");
    assert.equal(panelForGodmodeAction("wait_install"), "install");
    assert.equal(panelForGodmodeAction("upload_constructive"), "more");
    assert.equal(panelForGodmodeAction("run_ai_analysis"), "more");
    assert.equal(panelForGodmodeAction("handoff_to_cutting"), "general");
  });

  it("canQuickRunGodmodeAction — handoff і close_order", () => {
    assert.equal(canQuickRunGodmodeAction("handoff_to_edging"), true);
    assert.equal(canQuickRunGodmodeAction("ready_for_install"), true);
    assert.equal(canQuickRunGodmodeAction("close_order"), true);
    assert.equal(canQuickRunGodmodeAction("upload_constructive"), false);
  });

  it("isRunnableGodmodeAction — UI-дії не quick-run", () => {
    assert.equal(isRunnableGodmodeAction("add_position"), true);
    assert.equal(isRunnableGodmodeAction("create_tasks_from_ai"), false);
  });
});
