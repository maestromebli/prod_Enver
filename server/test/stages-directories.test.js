import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDirectoryList,
  CONSTRUCTORS_DIRECTORY_KEY
} from "../../shared/production/directories.js";
import {
  getNextStatus,
  stageLabel,
  stageStatusClass,
  isStageIdle
} from "../../shared/production/stages.js";

describe("directories shared", () => {
  it("getDirectoryList — case-insensitive ключ", () => {
    const dirs = { конструктори: ["Олег", "Іван"] };
    assert.deepEqual(getDirectoryList(dirs, CONSTRUCTORS_DIRECTORY_KEY), ["Олег", "Іван"]);
  });

  it("getDirectoryList — порожній ввід", () => {
    assert.deepEqual(getDirectoryList(null, "X"), []);
  });
});

describe("stages helpers", () => {
  it("getNextStatus цикл статусів", () => {
    assert.equal(getNextStatus("Не розпочато"), "Передано");
    assert.equal(getNextStatus("В роботі"), "Готово");
  });

  it("stageLabel і stageStatusClass", () => {
    assert.equal(stageLabel("cutting"), "Порізка");
    assert.equal(stageStatusClass("Готово"), "stage-done");
    assert.equal(isStageIdle("Не розпочато"), true);
  });
});
