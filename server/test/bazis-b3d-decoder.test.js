import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  analyzeBazisB3dBuffer,
  buildEnver3dscanFromB3dDecode,
  extractPanelPairsFromBinary,
  parseFieldDictionary,
  scanGabMinMaxPanels
} from "../src/constructive/bazis-b3d-decoder.js";
import { fuseBazisPackage } from "../src/constructive/enver-3dscan-fusion.js";

const SAMPLES_DIR = path.join(process.cwd(), "tools/b3d-samples/2026");

function samplePath(...parts) {
  return path.join(SAMPLES_DIR, ...parts);
}

describe("bazis-b3d-decoder", () => {
  it("parseFieldDictionary знаходить поля Mat/MinX у синтетиці", () => {
    const dict = Buffer.concat([
      Buffer.from([3, 0, 0, 0]),
      Buffer.from("Mat"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("Data"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MinX"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MaxX"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MinY"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MaxY"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MinZ"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("MaxZ"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("Name"),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from("Objs")
    ]);
    const parsed = parseFieldDictionary(dict, 0);
    assert.ok(parsed);
    assert.ok(parsed.entries.some((e) => e.name === "MinX"));
  });

  it("extractPanelPairsFromBinary — пари розмірів", () => {
    const payload = Buffer.alloc(128);
    payload.writeDoubleLE(800, 32);
    payload.writeDoubleLE(600, 40);
    payload.writeDoubleLE(18, 56);
    payload.writeDoubleLE(1200, 64);
    payload.writeDoubleLE(400, 72);
    payload.writeDoubleLE(18, 88);

    const panels = extractPanelPairsFromBinary(payload, { minPanels: 2, minOccurrences: 1 });
    assert.ok(panels.length >= 2);
    assert.ok(panels.some((p) => p.lengthMm === 800 && p.widthMm === 600));
  });

  it("scanGabMinMaxPanels — габарит панелі", () => {
    const payload = Buffer.alloc(256);
    const off = 100;
    payload.writeDoubleLE(0, off);
    payload.writeDoubleLE(0, off + 8);
    payload.writeDoubleLE(0, off + 16);
    payload.writeDoubleLE(847, off + 24);
    payload.writeDoubleLE(320, off + 32);
    payload.writeDoubleLE(18, off + 40);

    const panels = scanGabMinMaxPanels(payload);
    assert.equal(panels.length, 1);
    assert.equal(Math.round(panels[0].lengthMm), 847);
    assert.equal(Math.round(panels[0].thicknessMm), 18);
    assert.ok(panels[0].centerMm);
  });

  it("реальний Стелажи .b3d — декодує панелі без .project", () => {
    const p = samplePath("2026/Е-100 ВІтя Стелажи/Е-100 Вітя Стелажи  (5).b3d");
    if (!fs.existsSync(p)) return;

    const buf = fs.readFileSync(p);
    const { scan, analysis } = buildEnver3dscanFromB3dDecode(buf);
    assert.ok(analysis.isBazis);
    assert.ok(analysis.importantFields.includes("MinX"));
    assert.ok(scan?.panels?.length >= 1, "очікуємо хоча б 1 панель з MinX/MaxX");
    assert.ok(analysis.stats.posedPanelCount >= 1);
    assert.ok(analysis.stats.gabPanelCount >= 2);
    assert.ok(scan.panels.length <= 12, "без шумних binary_pair панелей має бути компактний набір");

    const fused = fuseBazisPackage({ b3dBuffer: buf });
    assert.ok(fused.parts.length >= 1);
    assert.ok(fused.scan?.source === "bazis_b3d_decode" || fused.assemblyExport);
  });

  it("Гардероб .b3d + .project — координати з b3d або flat", () => {
    const b3d = samplePath("2026/Е-105 Юніт Хоум/Гардероб/Гардероб (4).b3d");
    const project = samplePath(
      "2026/Е-105 Юніт Хоум/Гардероб/Е-105 Юнiт Хоум (ВВ) Гардероб.project"
    );
    if (!fs.existsSync(b3d) || !fs.existsSync(project)) return;

    const fused = fuseBazisPackage({
      b3dBuffer: fs.readFileSync(b3d),
      projectBuffer: fs.readFileSync(project)
    });
    assert.ok(fused.parts.length > 10);
    assert.ok(fused.stats.b3dFields?.includes("Pos1"));
  });

  it("analyzeBazisB3dBuffer на порожньому буфері", () => {
    const r = analyzeBazisB3dBuffer(Buffer.alloc(0));
    assert.equal(r.panels.length, 0);
    assert.ok(r.warnings.length);
  });
});
