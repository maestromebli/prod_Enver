import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INSECURE_DEFAULTS,
  assertProductionSafety,
  getProductionSecurityErrors,
  config
} from "../src/config.js";

describe("production config safety", () => {
  it("дефолтний sessionSecret відомий для перевірки", () => {
    assert.equal(INSECURE_DEFAULTS.sessionSecret, "enver-dev-secret");
  });

  it("assertProductionSafety не падає у dev", () => {
    assertProductionSafety();
  });

  it("getProductionSecurityErrors порожній у dev", () => {
    assert.deepEqual(getProductionSecurityErrors({ ...config, isProduction: false }), []);
  });

  it("getProductionSecurityErrors ловить небезпечні production-секрети", () => {
    const errors = getProductionSecurityErrors({
      isProduction: true,
      sessionSecret: INSECURE_DEFAULTS.sessionSecret
    });
    assert.ok(errors.some((e) => e.includes("SESSION_SECRET")));

    const prev = process.env.ADMIN_DEFAULT_PASSWORD;
    process.env.ADMIN_DEFAULT_PASSWORD = "admin";
    try {
      const adminErrors = getProductionSecurityErrors({
        isProduction: true,
        sessionSecret: "strong-random-secret"
      });
      assert.ok(adminErrors.some((e) => e.includes("ADMIN_DEFAULT_PASSWORD")));
    } finally {
      if (prev === undefined) delete process.env.ADMIN_DEFAULT_PASSWORD;
      else process.env.ADMIN_DEFAULT_PASSWORD = prev;
    }
  });
});
