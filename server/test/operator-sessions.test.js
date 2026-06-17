import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOperatorSessionActive,
  stageStatusFromRow,
  OPERATOR_ACTIVE_STATUSES
} from "../src/operator-sessions.js";

describe("operator-sessions", () => {
  it("stageStatusFromRow повертає статус етапу", () => {
    const row = {
      cutting_status: "Передано",
      edging_status: "В роботі",
      drilling_status: "Не розпочато",
      assembly_status: "Готово"
    };
    assert.equal(stageStatusFromRow(row, "edging"), "В роботі");
    assert.equal(stageStatusFromRow(row, "unknown"), null);
  });

  it("isOperatorSessionActive лише для В роботі та На паузі", () => {
    const row = { cutting_status: "В роботі", edging_status: "Передано" };
    assert.equal(isOperatorSessionActive(row, "cutting"), true);
    assert.equal(isOperatorSessionActive(row, "edging"), false);
    assert.equal(isOperatorSessionActive(row, "cutting"), true);
    for (const status of ["Передано", "Готово", "Не розпочато", "Проблема"]) {
      assert.equal(
        isOperatorSessionActive({ cutting_status: status }, "cutting"),
        false,
        `«${status}» не блокує сесію`
      );
    }
  });

  it("OPERATOR_ACTIVE_STATUSES містить лише робочі стани", () => {
    assert.deepEqual([...OPERATOR_ACTIVE_STATUSES].sort(), ["В роботі", "На паузі"].sort());
  });
});
