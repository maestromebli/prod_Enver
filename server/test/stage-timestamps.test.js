import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stageTimestampsForPosition } from "../src/stage-timestamps.js";

describe("stageTimestampsForPosition", () => {
  it("повертає bucket або {}", () => {
    const map = new Map([[1, { cutting: new Date("2026-01-01") }]]);
    assert.deepEqual(stageTimestampsForPosition(map, 1).cutting, new Date("2026-01-01"));
    assert.deepEqual(stageTimestampsForPosition(map, 99), {});
  });
});
