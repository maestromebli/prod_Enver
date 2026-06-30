import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzePanelAxes,
  formatMeasureMm,
  mapCadHoleToLocal,
  measureDistanceMm,
  resolvePanelMm
} from "../../shared/production/part-viewer-cad.js";

describe("shared/production/part-viewer-cad", () => {
  const box = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 800, y: 18, z: 600 }
  };

  it("resolvePanelMm бере значення з cadGeometry або part", () => {
    assert.deepEqual(resolvePanelMm({ panelMm: { dx: 800, dy: 600, dz: 18 } }), {
      dx: 800,
      dy: 600,
      dz: 18
    });
    assert.deepEqual(resolvePanelMm(null, { length: 700, width: 500, thickness: 16 }), {
      dx: 700,
      dy: 500,
      dz: 16
    });
  });

  it("analyzePanelAxes визначає тонку вісь", () => {
    const axes = analyzePanelAxes(box);
    assert.equal(axes.thin, "y");
    assert.equal(axes.wide, "x");
    assert.equal(axes.mid, "z");
    assert.equal(axes.size.x, 800);
  });

  it("mapCadHoleToLocal для лицьової панелі", () => {
    const local = mapCadHoleToLocal(
      box,
      { face: "panel", xMm: 400, yMm: 300 },
      { dx: 800, dy: 600, dz: 18 }
    );
    assert.ok(local.x > 0);
    assert.ok(local.y > 0);
    assert.equal(local.thinAxis, "y");
    assert.equal(local.panelScaleMm, 800);
  });

  it("mapCadHoleToLocal для дна, лівої та правої грані", () => {
    const panelMm = { dx: 800, dy: 600, dz: 18 };
    const bottom = mapCadHoleToLocal(box, { face: "bottom", xMm: 100, yMm: 100 }, panelMm);
    const left = mapCadHoleToLocal(box, { kind: "bl", yMm: 200, zMm: 9 }, panelMm);
    const right = mapCadHoleToLocal(box, { kind: "br", yMm: 200, zMm: 9 }, panelMm);
    assert.ok(bottom.y < left.y || bottom.x !== left.x);
    assert.notEqual(left.x, right.x);
  });

  it("measureDistanceMm і formatMeasureMm", () => {
    const panelMm = { dx: 800, dy: 600, dz: 18 };
    const dist = measureDistanceMm({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0.3 }, box, panelMm);
    assert.ok(dist > 0);
    assert.match(formatMeasureMm(dist), /мм$/);
    assert.equal(formatMeasureMm(55), "55.0 мм");
    assert.equal(formatMeasureMm(5.5), "5.50 мм");
    assert.equal(formatMeasureMm(Number.NaN), "—");
  });
});
