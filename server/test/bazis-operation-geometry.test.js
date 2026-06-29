import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPartCadGeometry,
  parseBazisProgramGeometry
} from "../../shared/production/bazis-operation-geometry.js";
import { decodeProjectText } from "../src/constructive/parsers/project-text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const em09Project = path.join(
  __dirname,
  "../../data/uploads/constructive/261/packages/106/1782491379122-ЕМ-09 Гардеробна .project"
);

describe("bazis-operation-geometry", () => {
  it("parseBazisProgramGeometry витягує bf-отвори з координатами мм", () => {
    if (!fs.existsSync(em09Project)) return;
    const text = fs.readFileSync(em09Project);
    const projectText = decodeProjectText(text);
    const m = projectText.match(/code="0014x006x2"[^>]*program="([^"]+)"/i);
    assert.ok(m);
    const geom = parseBazisProgramGeometry(m[1]);
    assert.equal(geom.panelMm.dx, 1647);
    assert.equal(geom.panelMm.dy, 540);
    assert.ok(geom.holes.length >= 10);
    const first = geom.holes.find((h) => h.kind === "bf");
    assert.ok(first);
    assert.ok(Number.isFinite(first.xMm));
    assert.ok(Number.isFinite(first.yMm));
  });

  it("buildPartCadGeometry для №14 містить отвори з .project", () => {
    if (!fs.existsSync(em09Project)) return;
    const projectText = decodeProjectText(fs.readFileSync(em09Project));
    const cad = buildPartCadGeometry({
      projectTexts: [projectText],
      part: {
        partNo: "14",
        length: "1647",
        width: "540",
        thickness: "18",
        bazisOperationCodes: ["0014X006X1", "0014X006X2"]
      }
    });
    assert.ok(cad);
    assert.ok(cad.holeCount >= 20);
    assert.equal(cad.panelMm.dx, 1647);
    assert.ok(cad.edgeMask.some(Boolean));
  });
});
