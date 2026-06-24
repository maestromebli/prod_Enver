import assert from "node:assert/strict";
import { describe, it } from "node:test";

const PRODUCTION_STAGES = ["cutting", "edging", "drilling", "assembly", "packaging"];

function diffStages(aiStages, chosen) {
  const added = chosen.filter((s) => !aiStages.includes(s));
  const removed = aiStages.filter((s) => !chosen.includes(s));
  return { added, removed };
}

describe("ai-task-learning", () => {
  it("доданий drilling після AI", () => {
    const { added, removed } = diffStages(["cutting", "edging"], ["cutting", "edging", "drilling"]);
    assert.deepEqual(added, ["drilling"]);
    assert.deepEqual(removed, []);
  });

  it("без змін — порожній diff", () => {
    const { added, removed } = diffStages(["cutting"], ["cutting"]);
    assert.equal(added.length, 0);
    assert.equal(removed.length, 0);
  });

  it("тільки дозволені етапи", () => {
    const chosen = ["cutting", "hack"].filter((s) => PRODUCTION_STAGES.includes(s));
    assert.deepEqual(chosen, ["cutting"]);
  });
});
