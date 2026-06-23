import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSECURE_DEFAULTS, assertProductionSafety } from "../src/config.js";

describe("production config safety", () => {
  it("дефолтний sessionSecret відомий для перевірки", () => {
    assert.equal(INSECURE_DEFAULTS.sessionSecret, "enver-dev-secret");
  });

  it("assertProductionSafety не падає у dev", () => {
    assertProductionSafety();
  });
});
