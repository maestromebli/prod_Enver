import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  appendEnver3dscanToB3d,
  extractEnver3dscanFromB3d,
  isBazisB3dBuffer,
  parseEnver3dscanJson
} from "../../shared/production/enver-3dscan.js";
import { fuseBazisPackage } from "../src/constructive/enver-3dscan-fusion.js";
import { extractPackagePreviewGlb } from "../src/constructive/b3d-glb-extractor.js";

const SAMPLE_DIR = path.join(process.cwd(), "tools/b3d-samples/2026/2026/Е-105 Юніт Хоум/Гардероб");
const SAMPLE_B3D = path.join(SAMPLE_DIR, "Гардероб (4).b3d");
const SAMPLE_PROJECT = path.join(SAMPLE_DIR, "Е-105 Юнiт Хоум (ВВ) Гардероб.project");

const samplesExist = fs.existsSync(SAMPLE_B3D) && fs.existsSync(SAMPLE_PROJECT);

describe("ENVER_3dscan", () => {
  it("round-trip EN3DSC хвіст у .b3d", () => {
    const base = Buffer.from("BZ85" + "x".repeat(100), "ascii");
    const doc = parseEnver3dscanJson({
      kind: "ENVER_3dscan",
      version: 2,
      source: "test",
      panels: [
        {
          code: "10",
          name: "Полиця",
          centerMm: [100, 200, 300],
          sizeMm: [600, 400, 18],
          axisX: [1, 0, 0],
          axisY: [0, 1, 0],
          axisZ: [0, 0, 1],
          holes: [{ diameterMm: 5, xMm: 50, yMm: 50, face: "panel" }]
        }
      ]
    });
    const patched = appendEnver3dscanToB3d(base, doc);
    const read = extractEnver3dscanFromB3d(patched);
    assert.equal(read.panels.length, 1);
    assert.equal(read.panels[0].code, "10");
    assert.equal(read.panels[0].holes.length, 1);
  });

  it(
    "fuseBazisPackage: частковий sidecar не зменшує список панелей з .project",
    {
      skip: !samplesExist
    },
    () => {
      const projectBuffer = fs.readFileSync(SAMPLE_PROJECT);
      const partialScan = parseEnver3dscanJson({
        kind: "ENVER_3dscan",
        version: 2,
        source: "test",
        panels: [{ code: "10", name: "Тест", lengthMm: 600, widthMm: 400, thicknessMm: 18 }]
      });
      const fused = fuseBazisPackage({
        projectBuffer,
        scanJsonBuffer: Buffer.from(JSON.stringify(partialScan))
      });
      const fusedProjectOnly = fuseBazisPackage({ projectBuffer });
      assert.equal(
        fused.parts.length,
        fusedProjectOnly.parts.length,
        "частковий sidecar не повинен зменшувати кількість деталей"
      );
    }
  );

  it("fuseBazisPackage з реальними зразками 2026", { skip: !samplesExist }, () => {
    const b3dBuffer = fs.readFileSync(SAMPLE_B3D);
    const projectBuffer = fs.readFileSync(SAMPLE_PROJECT);
    assert.equal(isBazisB3dBuffer(b3dBuffer), true);

    const fused = fuseBazisPackage({ b3dBuffer, projectBuffer });
    assert.ok(fused.parts.length > 50, `очікуємо багато деталей, отримано ${fused.parts.length}`);
    assert.ok(fused.scan?.panels?.length > 0);
    assert.equal(fused.stats.hasProject, true);
    assert.equal(fused.stats.hasB3d, true);

    const preview = extractPackagePreviewGlb({ b3dBuffer, projectBuffer });
    assert.ok(preview.buffer?.length > 1000);
    assert.ok(
      ["enver_3dscan_flat", "project_panels", "b3d_enver_3dscan_assembly"].includes(preview.source)
    );
  });
});
