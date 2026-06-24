import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapHistory, SYSTEM_ACTOR } from "../src/audit.js";

describe("audit auto_handoff", () => {
  it("SYSTEM_ACTOR має ім'я Система", () => {
    assert.equal(SYSTEM_ACTOR.name, "Система");
  });

  it("mapHistory підтримує auto_handoff", () => {
    const entry = mapHistory({
      id: 1,
      entity_type: "position",
      entity_id: 10,
      action: "auto_handoff",
      summary: "Автопередача",
      changes_json: "[]",
      order_number: "T-1",
      item_label: "Кухня",
      user_id: null,
      user_name: "Система",
      created_at: "2026-06-24 10:00:00"
    });
    assert.equal(entry.actionLabel, "Автопередача");
    assert.equal(entry.userName, "Система");
  });
});
