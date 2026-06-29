import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimatePositionProgress,
  renderConstructiveFileList,
  renderPositionPipeline
} from "../src/position-drawer-render.js";

describe("position-drawer-render", () => {
  it("estimatePositionProgress — усі етапи готові ≈ 100%", () => {
    const p = {
      cuttingStatus: "Готово",
      edgingStatus: "Готово",
      drillingStatus: "Готово",
      assemblyStatus: "Готово"
    };
    assert.equal(estimatePositionProgress(p), 100);
  });

  it("estimatePositionProgress — лише порізка передана", () => {
    const p = {
      cuttingStatus: "Передано",
      edgingStatus: "Не розпочато",
      drillingStatus: "Не розпочато",
      assemblyStatus: "Не розпочато"
    };
    assert.equal(estimatePositionProgress(p), 9);
  });

  it("renderConstructiveFileList без файлів — порожній рядок", () => {
    assert.equal(renderConstructiveFileList([], 1), "");
  });

  it("renderPositionPipeline містить поточний етап", () => {
    const html = renderPositionPipeline({
      currentStage: "cutting",
      cuttingStatus: "В роботі",
      edgingStatus: "Не розпочато",
      drillingStatus: "Не розпочато",
      assemblyStatus: "Не розпочато"
    });
    assert.match(html, /pipeline-compact--readonly/);
    assert.match(html, /Порізка/);
    assert.doesNotMatch(html, /data-pipeline-jump/);
  });
});
