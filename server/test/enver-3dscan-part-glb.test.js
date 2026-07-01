import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findScanPanelForPart,
  layoutScanPanelForDetail,
  resolveScanPanelDimensions
} from "../../shared/production/enver-3dscan-part-layout.js";
import { buildPartDetailGlbFromScanPanel } from "../src/constructive/enver-3dscan-part-glb.js";

const GLB_MAGIC = 0x46546c67;

describe("ENVER_3dscan part GLB", () => {
  it("resolveScanPanelDimensions з sizeMm", () => {
    const dims = resolveScanPanelDimensions({
      sizeMm: [600, 400, 18]
    });
    assert.equal(dims.lengthMm, 600);
    assert.equal(dims.widthMm, 400);
    assert.equal(dims.thicknessMm, 18);
  });

  it("findScanPanelForPart за partNo", () => {
    const scan = {
      panels: [{ code: "12", name: "Полиця", lengthMm: 500, widthMm: 300, thicknessMm: 18 }]
    };
    const part = { partNo: "12", partName: "Полиця" };
    assert.equal(findScanPanelForPart(scan, part)?.code, "12");
  });

  it("buildPartDetailGlbFromScanPanel повертає валідний GLB", () => {
    const laidOut = layoutScanPanelForDetail({
      code: "5",
      name: "Бік",
      lengthMm: 720,
      widthMm: 560,
      thicknessMm: 18
    });
    assert.ok(laidOut.scale.x > 0);

    const built = buildPartDetailGlbFromScanPanel(
      { code: "5", name: "Бік", lengthMm: 720, widthMm: 560, thicknessMm: 18 },
      { productName: "Тест" }
    );
    assert.ok(built.buffer.length > 20);
    assert.equal(built.buffer.readUInt32LE(0), GLB_MAGIC);
    assert.equal(built.panelCount, 1);
  });
});
