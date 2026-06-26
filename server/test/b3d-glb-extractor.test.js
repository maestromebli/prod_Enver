import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import {
  extractGlbFromB3d,
  extractPackagePreviewGlb,
  findEmbeddedGlb,
  decompressB3dCandidates,
  scanZlibBlocks
} from "../src/constructive/b3d-glb-extractor.js";
import { buildPreviewGlbFromProject } from "../src/constructive/project-glb-builder.js";
import { appendEnverAssemblyToB3d } from "../src/constructive/parsers/assembly-export.js";

describe("b3d-glb-extractor", () => {
  it("розпізнає сирий GLB у .b3d", () => {
    const glb = buildPreviewGlbFromProject(
      Buffer.from(
        `<?xml version="1.0"?><project><part code="1" name="A" dl="100" dw="200"/></project>`,
        "utf8"
      )
    );
    const result = extractGlbFromB3d(glb.buffer);
    assert.equal(result.source, "raw_glb");
    assert.ok(result.buffer.length > 100);
  });

  it("знаходить вбудований GLB у бінарному контейнері", () => {
    const glb = buildPreviewGlbFromProject(
      Buffer.from(
        `<?xml version="1.0"?><project><part code="2" name="B" dl="300" dw="400"/></project>`,
        "utf8"
      )
    );
    const wrapper = Buffer.concat([Buffer.from("BZ85Furniture\x00"), glb.buffer, Buffer.from("END")]);
    const embedded = findEmbeddedGlb(wrapper);
    assert.ok(embedded);
    const result = extractGlbFromB3d(wrapper);
    assert.equal(result.source, "embedded_glb");
  });

  it("будує GLB з XML усередині .b3d", () => {
    const xml = `<?xml version="1.0"?><project><part code="10" name="Стійка" dl="500" dw="300"/></project>`;
    const wrapper = Buffer.concat([Buffer.from("GibLab\x00"), Buffer.from(xml, "utf8")]);
    const result = extractGlbFromB3d(wrapper);
    assert.equal(result.source, "b3d_xml_panels");
    assert.equal(result.panelCount, 1);
  });

  it("scanZlibBlocks знаходить zlib у контейнері", () => {
    const payload = Buffer.from("test geometry X Y Z TriData");
    const compressed = zlib.deflateSync(payload);
    const wrapper = Buffer.concat([Buffer.from("BZ85"), compressed]);
    const blocks = scanZlibBlocks(wrapper);
    assert.ok(blocks.length >= 1);
    assert.ok(blocks[0].data.includes("TriData"));
  });

  it("decompressB3dCandidates повертає вихідний буфер", () => {
    const buf = Buffer.from("test");
    const candidates = decompressB3dCandidates(buf);
    assert.ok(candidates.some((c) => c.equals(buf)));
  });

  it("будує GLB з .project, якщо GibLab .b3d без геометрії", () => {
    const xml = `<?xml version="1.0"?><project><part code="10" name="A" dl="500" dw="300"/></project>`;
    const bz85 = Buffer.concat([Buffer.from("BZ85\x00"), Buffer.alloc(400)]);
    const result = extractPackagePreviewGlb({
      b3dBuffer: bz85,
      projectBuffer: Buffer.from(xml, "utf8")
    });
    assert.equal(result.source, "project_panels");
    assert.equal(result.layout, "flat");
    assert.equal(result.panelCount, 1);
  });

  it("будує збірку з ENVER3 у .b3d", () => {
    const xml = `<?xml version="1.0"?><project><part code="10" name="A" dl="500" dw="300"/></project>`;
    const assembly = {
      version: 1,
      panels: [
        {
          code: "10",
          centerMm: [250, 150, 500],
          sizeMm: [500, 300, 18],
          axisX: [1, 0, 0],
          axisY: [0, 1, 0],
          axisZ: [0, 0, 1]
        }
      ]
    };
    const bz85 = appendEnverAssemblyToB3d(Buffer.from("BZ85\x00"), assembly);
    const result = extractPackagePreviewGlb({
      b3dBuffer: bz85,
      projectBuffer: Buffer.from(xml, "utf8")
    });
    assert.equal(result.layout, "assembly");
    assert.equal(result.source, "b3d_enver3_assembly");
  });

  it("кидає помилку для порожнього .b3d", () => {
    assert.throws(() => extractGlbFromB3d(Buffer.alloc(0)), /Порожній/);
  });
});
