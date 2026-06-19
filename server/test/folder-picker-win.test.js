import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { windowsFolderPickerAvailable } from "../src/folder-picker-win.js";

describe("folder-picker-win", () => {
  it("windowsFolderPickerAvailable залежить від платформи", () => {
    const available = windowsFolderPickerAvailable();
    if (process.platform === "win32") {
      assert.equal(available, true);
    } else {
      assert.equal(available, false);
    }
  });
});
