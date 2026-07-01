import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  analyzeBazisB3dBuffer,
  buildEnver3dscanFromB3dDecode,
  extractPanelPairsFromBinary,
  linkPanelsWithNearbyDirs,
  parseFieldDictionary,
  readOrthonormalAxesF32,
  scanGabMinMaxPanels,
  assignCodesFromXmlPanels
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

  it("readOrthonormalAxesF32 нормалізує довільну довжину Bazis-напрямку", () => {
    const payload = Buffer.alloc(48);
    payload.writeFloatLE(0, 0);
    payload.writeFloatLE(0, 4);
    payload.writeFloatLE(529, 8);
    payload.writeFloatLE(400, 12);
    payload.writeFloatLE(0, 16);
    payload.writeFloatLE(0, 20);
    payload.writeFloatLE(0, 24);
    payload.writeFloatLE(300, 28);
    payload.writeFloatLE(0, 32);

    const axes = readOrthonormalAxesF32(payload, 0);
    assert.ok(axes);
    assert.ok(Math.abs(axes.axisX[2] - 1) < 0.01);
    assert.ok(Math.abs(axes.axisY[0] - 1) < 0.01);
    assert.ok(Math.abs(axes.axisZ[1] - 1) < 0.01);
  });

  it("linkPanelsWithNearbyDirs зіставляє осі з габаритами", () => {
    const payload = Buffer.alloc(900);
    const gabOff = 200;
    payload.writeDoubleLE(0, gabOff);
    payload.writeDoubleLE(0, gabOff + 8);
    payload.writeDoubleLE(0, gabOff + 16);
    payload.writeDoubleLE(500, gabOff + 24);
    payload.writeDoubleLE(300, gabOff + 32);
    payload.writeDoubleLE(18, gabOff + 40);

    const dirOff = gabOff + 139;
    payload.writeFloatLE(0, dirOff);
    payload.writeFloatLE(0, dirOff + 4);
    payload.writeFloatLE(200, dirOff + 8);
    payload.writeFloatLE(180, dirOff + 12);
    payload.writeFloatLE(0, dirOff + 16);
    payload.writeFloatLE(0, dirOff + 20);
    payload.writeFloatLE(0, dirOff + 24);
    payload.writeFloatLE(150, dirOff + 28);
    payload.writeFloatLE(0, dirOff + 32);

    const gab = scanGabMinMaxPanels(payload);
    assert.equal(gab.length, 1);
    const linked = linkPanelsWithNearbyDirs(gab, payload);
    assert.equal(linked[0].dirSource, "b3d_dir_f32");
    assert.ok(Math.abs(linked[0].axisX[2] - 1) < 0.05);
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
    assert.ok(analysis.stats.posedWithDirsCount >= 1, "очікуємо DirX/DirY/DirZ з .b3d");

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

  it("assignCodesFromXmlPanels зіставляє code за розмірами", () => {
    const decoded = [{ lengthMm: 800, widthMm: 400, thicknessMm: 18, centerMm: [400, 200, 100] }];
    const xml = [{ code: "42", name: "Полка", lengthMm: 800, widthMm: 400, thicknessMm: 18 }];
    const linked = assignCodesFromXmlPanels(decoded, xml);
    assert.equal(linked[0].code, "42");
  });

  it("analyzeBazisB3dBuffer на порожньому буфері", () => {
    const r = analyzeBazisB3dBuffer(Buffer.alloc(0));
    assert.equal(r.panels.length, 0);
    assert.ok(r.warnings.length);
  });
});
