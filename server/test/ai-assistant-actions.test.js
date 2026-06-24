import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAssistantAction, validateAssistantActions } from "../src/ai/assistant-actions.js";

describe("assistant-actions whitelist", () => {
  it("дозволяє open_position", () => {
    const a = validateAssistantAction({
      label: "Відкрити",
      type: "open_position",
      payload: { positionId: 5 }
    });
    assert.equal(a.type, "open_position");
    assert.equal(a.requiresConfirmation, false);
  });

  it("відхиляє delete", () => {
    assert.equal(validateAssistantAction({ type: "delete", payload: {} }), null);
  });

  it("відхиляє довільний URL action", () => {
    assert.equal(validateAssistantAction({ type: "url", payload: { url: "http://x" } }), null);
  });

  it("run_position_action потребує підтвердження", () => {
    const a = validateAssistantAction({
      label: "Передати",
      type: "run_position_action",
      payload: { positionId: 1, actionType: "handoff_to_cutting" }
    });
    assert.equal(a.requiresConfirmation, true);
  });

  it("відхиляє невідомий actionType", () => {
    assert.equal(
      validateAssistantAction({
        type: "run_position_action",
        payload: { positionId: 1, actionType: "drop_database" }
      }),
      null
    );
  });

  it("validateAssistantActions фільтрує масив", () => {
    const list = validateAssistantActions([
      { type: "open_tab", payload: { tab: "Позиції" }, label: "Позиції" },
      { type: "sql", payload: {}, label: "hack" }
    ]);
    assert.equal(list.length, 1);
  });
});
