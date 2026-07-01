import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGE_WIZARD_STEPS,
  resolvePackageWizardStep
} from "../src/constructive-package-wizard.js";

describe("constructive-package-wizard", () => {
  it("resolvePackageWizardStep — без пакета → завантаження", () => {
    assert.equal(resolvePackageWizardStep(null), 0);
    assert.equal(resolvePackageWizardStep({ package: { status: "uploaded" }, files: [] }), 0);
  });

  it("resolvePackageWizardStep — uploaded з файлами лишається на завантаженні", () => {
    const detail = {
      package: { status: "uploaded" },
      files: [{ id: 1 }]
    };
    assert.equal(resolvePackageWizardStep(detail), 0);
  });

  it("resolvePackageWizardStep — parsing → розбір", () => {
    const detail = {
      package: { status: "parsing" },
      files: [{ id: 1 }]
    };
    assert.equal(resolvePackageWizardStep(detail), 1);
  });

  it("resolvePackageWizardStep — parsed → перевірка", () => {
    const detail = {
      package: { status: "parsed" },
      files: [{ id: 1 }],
      parts: [{ partNo: "1" }]
    };
    assert.equal(resolvePackageWizardStep(detail), 2);
  });

  it("resolvePackageWizardStep — approved → передача", () => {
    const detail = {
      package: { status: "approved_by_constructor" },
      files: [{ id: 1 }],
      parts: [{ partNo: "1" }]
    };
    assert.equal(resolvePackageWizardStep(detail), 3);
  });

  it("PACKAGE_WIZARD_STEPS — чотири кроки", () => {
    assert.equal(PACKAGE_WIZARD_STEPS.length, 4);
    assert.deepEqual(
      PACKAGE_WIZARD_STEPS.map((s) => s.key),
      ["upload", "parse", "verify", "handoff"]
    );
  });
});
