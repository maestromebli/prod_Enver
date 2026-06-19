import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSECURE_DEFAULTS } from "../src/config.js";

describe("production config safety", () => {
  it("дефолтні секрети відомі для перевірки", () => {
    assert.equal(INSECURE_DEFAULTS.sessionSecret, "enver-dev-secret");
    assert.equal(INSECURE_DEFAULTS.agentToken, "enver-agent-dev-token");
  });
});
