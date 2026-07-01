import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendEnverAssemblyToB3d,
  extractEnverAssemblyFromB3d
} from "../src/constructive/parsers/assembly-export.js";
import {
  buildPatchedB3dWithEnver3,
  isEnverAssemblyJsonName,
  loadAssemblyExportFromJsonBuffer,
  autoSyncEnver3FromPackageDecode
} from "../src/constructive/b3d-auto-enver3.js";
import { buildAssemblyExportFromScanPanels } from "../src/constructive/parsers/assembly-export.js";

describe("b3d-auto-enver3", () => {
  const assembly = {
    version: 1,
    source: "bazis",
    panels: [
      {
        code: "10",
        centerMm: [100, 200, 300],
        sizeMm: [500, 300, 18],
        axisX: [1, 0, 0],
        axisY: [0, 1, 0],
        axisZ: [0, 0, 1]
      }
    ]
  };

  it("isEnverAssemblyJsonName розпізнає sidecar", () => {
    assert.equal(isEnverAssemblyJsonName("enver-assembly.json"), true);
    assert.equal(isEnverAssemblyJsonName("foo.enver-assembly.json"), true);
    assert.equal(isEnverAssemblyJsonName("model.b3d"), false);
  });

  it("buildPatchedB3dWithEnver3 дописує ENVER3", async () => {
    const raw = Buffer.from("BZ85\x00");
    const result = await buildPatchedB3dWithEnver3(raw, assembly);
    assert.equal(result.alreadyPresent, false);
    assert.ok(extractEnverAssemblyFromB3d(result.buffer));
    assert.equal(result.panelCount, 1);
  });

  it("buildPatchedB3dWithEnver3 не дублює ENVER3", async () => {
    const patched = appendEnverAssemblyToB3d(Buffer.from("BZ85\x00"), assembly);
    const result = await buildPatchedB3dWithEnver3(patched, assembly);
    assert.equal(result.alreadyPresent, true);
  });

  it("loadAssemblyExportFromJsonBuffer парсить JSON", async () => {
    const parsed = await loadAssemblyExportFromJsonBuffer(
      Buffer.from(JSON.stringify(assembly), "utf8")
    );
    assert.equal(parsed.panels.length, 1);
    assert.equal(parsed.panels[0].code, "10");
  });

  it("autoSyncEnver3FromPackageDecode повертає no_b3d без файлу", async () => {
    const result = await autoSyncEnver3FromPackageDecode({ fileRows: [] });
    assert.equal(result.applied, false);
    assert.equal(result.reason, "no_b3d");
  });

  it("buildAssemblyExportFromScanPanels для синтетичного scan", () => {
    const exported = buildAssemblyExportFromScanPanels({
      panels: [
        {
          code: "1",
          centerMm: [250, 150, 500],
          lengthMm: 500,
          widthMm: 300,
          thicknessMm: 18
        }
      ]
    });
    assert.equal(exported?.panels?.length, 1);
  });
});
