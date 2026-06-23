import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFolderKey, folderStateLabel } from "../src/folder-sync.js";

describe("folder-sync helpers", () => {
  it("normalizeFolderKey", () => {
    assert.equal(normalizeFolderKey(" EN 2405 "), "EN-2405");
  });

  it("folderStateLabel", () => {
    assert.equal(folderStateLabel("inbox"), "Очікує");
    assert.equal(folderStateLabel("active"), "В роботі (папка)");
  });
});
