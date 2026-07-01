import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { extractEnver3dscanFromB3d } from "../../shared/production/enver-3dscan.js";
import {
  buildPatchedB3dWithEnver3dscan,
  deriveScanDocumentFromPackage
} from "../src/constructive/b3d-auto-3dscan.js";

const SAMPLE_DIR = path.join(process.cwd(), "tools/b3d-samples/2026/2026/Е-105 Юніт Хоум/Гардероб");
const SAMPLE_B3D = path.join(SAMPLE_DIR, "Гардероб (4).b3d");
const SAMPLE_PROJECT = path.join(SAMPLE_DIR, "Е-105 Юнiт Хоум (ВВ) Гардероб.project");

const samplesExist = fs.existsSync(SAMPLE_B3D) && fs.existsSync(SAMPLE_PROJECT);

describe("b3d-auto-3dscan", () => {
  it("deriveScanDocumentFromPackage повертає null без буферів", () => {
    assert.equal(deriveScanDocumentFromPackage({}), null);
  });

  it("buildPatchedB3dWithEnver3dscan дописує ENVER_3dscan", async () => {
    const raw = Buffer.from("BZ85" + "x".repeat(100), "ascii");
    const scan = {
      kind: "ENVER_3dscan",
      version: 2,
      source: "test",
      panels: [{ code: "1", name: "Полиця", lengthMm: 500, widthMm: 300, thicknessMm: 18 }]
    };
    const result = await buildPatchedB3dWithEnver3dscan(raw, scan);
    assert.ok(result);
    assert.equal(result.alreadyPresent, false);
    assert.ok(extractEnver3dscanFromB3d(result.buffer));
  });

  it("deriveScanDocumentFromPackage + patch з реальних .project + .b3d", async () => {
    if (!samplesExist) return;

    const b3dBuffer = fs.readFileSync(SAMPLE_B3D);
    const projectBuffer = fs.readFileSync(SAMPLE_PROJECT);
    const scan = deriveScanDocumentFromPackage({ b3dBuffer, projectBuffer });
    assert.ok(scan?.panels?.length, "очікуємо панелі з .project + .b3d");

    const patched = await buildPatchedB3dWithEnver3dscan(b3dBuffer, scan);
    assert.ok(patched);
    assert.equal(patched.alreadyPresent, false);
    assert.ok(extractEnver3dscanFromB3d(patched.buffer));
  });
});
