import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickNextQueuePosition } from "../src/operator-automation.js";

describe("operator-automation", () => {
  it("pickNextQueuePosition — перша «Передано»", async () => {
    const { state } = await import("../src/state.js");
    state.operatorStage = "cutting";
    state.operatorQueue = [
      { id: 1, cuttingStatus: "Готово" },
      { id: 2, cuttingStatus: "Передано" },
      { id: 3, cuttingStatus: "Передано" }
    ];
    const next = pickNextQueuePosition();
    assert.equal(next?.id, 2);
  });
});
