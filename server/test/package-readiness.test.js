import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePackageReadiness,
  packageReadinessScore
} from "../../shared/production/package-readiness.js";

describe("package-readiness", () => {
  it("ready коли project + b3d + parts + enver3", () => {
    const r = evaluatePackageReadiness({
      files: [{ kind: "project" }, { kind: "b3d" }, { kind: "spec_xls" }],
      parts: [{ id: 1 }, { id: 2 }],
      preview3d: { enver3Sync: { applied: true, panelCount: 12 } },
      unmappedParts: []
    });
    assert.equal(r.readyForAutoHandoff, true);
    assert.equal(r.hasEnver3, true);
    assert.ok(packageReadinessScore(r) >= 80);
  });

  it("блокує PARTIAL_READY без ENVER3", () => {
    const r = evaluatePackageReadiness({
      files: [{ kind: "project" }, { kind: "b3d" }],
      parts: [{ id: 1 }],
      preview3d: { conversionStatus: "PARTIAL_READY" },
      unmappedParts: []
    });
    assert.equal(r.partialB3d, true);
    assert.equal(r.readyForAutoHandoff, false);
  });
});
