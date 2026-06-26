import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deactivateFocusTrap, getFocusableElements } from "../src/focus-trap.js";

describe("focus-trap", () => {
  it("getFocusableElements без root — порожній масив", () => {
    assert.deepEqual(getFocusableElements(null), []);
    assert.deepEqual(getFocusableElements(undefined), []);
  });

  it("deactivateFocusTrap без активного trap не падає", () => {
    deactivateFocusTrap();
  });
});
