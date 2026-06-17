import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFolderKey, folderStateLabel, mapMachineProgress } from "../src/folder-sync.js";

describe("folder-sync helpers", () => {
  it("normalizeFolderKey", () => {
    assert.equal(normalizeFolderKey(" EN 2405 "), "EN-2405");
  });

  it("folderStateLabel", () => {
    assert.equal(folderStateLabel("inbox"), "Очікує");
    assert.equal(folderStateLabel("active"), "В роботі (папка)");
  });

  it("mapMachineProgress", () => {
    const m = mapMachineProgress(
      JSON.stringify({ percent: 50, piecesDone: 5, piecesTotal: 10, cutLengthMm: 3200 })
    );
    assert.equal(m.percent, 50);
    assert.equal(m.piecesDone, 5);
    assert.equal(m.cutLengthM, 3.2);
  });
});
