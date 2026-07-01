import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extrudeContourMesh,
  triangulatePolygon2d
} from "../../shared/production/enver-3dscan-contour-mesh.js";
import { buildPartDetailGlbFromScanPanel } from "../src/constructive/enver-3dscan-part-glb.js";

const GLB_MAGIC = 0x46546c67;

describe("enver-3dscan-contour-mesh", () => {
  it("triangulatePolygon2d для прямокутника", () => {
    const tris = triangulatePolygon2d([
      [0, 0],
      [1000, 0],
      [1000, 500],
      [0, 500]
    ]);
    assert.equal(tris.length, 6);
  });

  it("extrudeContourMesh дає геометрію з товщиною по Y", () => {
    const mesh = extrudeContourMesh(
      [
        [0, 0],
        [1632, 0],
        [1632, 540],
        [0, 540]
      ],
      18
    );
    assert.ok(mesh);
    assert.equal(mesh.positions.length % 3, 0);
    assert.ok(mesh.height > 0 && mesh.height < 0.05);
    let maxY = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      maxY = Math.max(maxY, mesh.positions[i]);
    }
    assert.ok(Math.abs(maxY - mesh.height) < 1e-6);
  });

  it("buildPartDetailGlbFromScanPanel з контуром — валідний GLB", () => {
    const built = buildPartDetailGlbFromScanPanel(
      {
        code: "15",
        name: "Дно шафи ліва",
        lengthMm: 1632,
        widthMm: 540,
        thicknessMm: 18,
        contourMm: [
          [0, 0],
          [1632, 0],
          [1632, 540],
          [0, 540]
        ]
      },
      { productName: "Тест" }
    );
    assert.equal(built.buffer.readUInt32LE(0), GLB_MAGIC);
    assert.equal(built.code, "15");
  });
});
