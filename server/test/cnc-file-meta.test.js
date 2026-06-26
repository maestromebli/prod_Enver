import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCncFileMaterialLabel,
  inferCncFileMaterialMeta,
  isMultiInstancePackageFileKind,
  summarizeCncPackageFiles
} from "../../shared/production/cnc-file-meta.js";

describe("cnc-file-meta", () => {
  it("cnc_file — множинний kind у пакеті", () => {
    assert.equal(isMultiInstancePackageFileKind("cnc_file"), true);
    assert.equal(isMultiInstancePackageFileKind("b3d"), false);
  });

  it("визначає тип і декор з імені файлу", () => {
    assert.deepEqual(inferCncFileMaterialMeta("E30_ДСП_18_W960_SM.kdt"), {
      materialType: "ДСП",
      materialDecor: "W960"
    });
    assert.deepEqual(inferCncFileMaterialMeta("kitchen_МДФ_16.giblab"), {
      materialType: "МДФ",
      materialDecor: ""
    });
  });

  it("formatCncFileMaterialLabel і summarizeCncPackageFiles", () => {
    assert.equal(
      formatCncFileMaterialLabel({ materialType: "ДСП", materialDecor: "W960" }),
      "ДСП · W960"
    );
    const summary = summarizeCncPackageFiles([
      { kind: "b3d", materialType: "", materialDecor: "" },
      { kind: "cnc_file", materialType: "ДСП", materialDecor: "W960" },
      { kind: "cnc_file", materialType: "МДФ", materialDecor: "U702" }
    ]);
    assert.equal(summary.count, 2);
    assert.deepEqual(summary.types, ["ДСП", "МДФ"]);
    assert.deepEqual(summary.decors, ["W960", "U702"]);
  });
});
