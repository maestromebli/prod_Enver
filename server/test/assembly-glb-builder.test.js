import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAssemblyGlbFromProject,
  buildMixedPreviewGlb,
  layoutAssemblyPanels,
  bazisMmToGltf
} from "../src/constructive/assembly-glb-builder.js";
import {
  appendEnverAssemblyToB3d,
  extractEnverAssemblyFromB3d,
  parseAssemblyExportJson,
  buildAssemblyExportFromScanPanels
} from "../src/constructive/parsers/assembly-export.js";
import { extractPackagePreviewGlb } from "../src/constructive/b3d-glb-extractor.js";
import {
  extractProjectPanels,
  readPreviewLayoutFromGlb
} from "../src/constructive/project-glb-builder.js";
import { preview3dLayout } from "../../shared/production/constructive-package.js";

const sampleXml = `<?xml version="1.0"?><project>
  <part code="10" name="Стійка" dl="1896.00" dw="540.00"/>
  <part code="11" name="Полиця" dl="800.00" dw="400.00"/>
  <operation code="0010x002x1" program="&lt;program dx=&quot;1896&quot; dy=&quot;540&quot; dz=&quot;18&quot;/&gt;"/>
</project>`;

const sampleAssembly = {
  version: 1,
  source: "bazis",
  panels: [
    {
      code: "10",
      centerMm: [948, 270, 900],
      sizeMm: [1896, 540, 18],
      axisX: [1, 0, 0],
      axisY: [0, 1, 0],
      axisZ: [0, 0, 1]
    },
    {
      code: "11",
      centerMm: [400, 200, 450],
      sizeMm: [800, 400, 18],
      axisX: [1, 0, 0],
      axisY: [0, 1, 0],
      axisZ: [0, 0, 1]
    }
  ]
};

describe("assembly-glb-builder", () => {
  it("bazisMmToGltf переводить Z-вгору в Y-вгору glTF", () => {
    const p = bazisMmToGltf([100, 200, 300]);
    assert.equal(p.x, 0.1);
    assert.equal(p.y, 0.3);
    assert.equal(p.z, -0.2);
  });

  it("layoutAssemblyPanels зіставляє code з .project", () => {
    const projectPanels = extractProjectPanels(Buffer.from(sampleXml, "utf8"));
    const { panels, missing } = layoutAssemblyPanels(projectPanels, sampleAssembly);
    assert.equal(panels.length, 2);
    assert.deepEqual(missing, []);
    assert.ok(panels[0].rotation?.length === 4);
    assert.ok(panels[0].position.x > 0);
  });

  it("buildAssemblyGlbFromProject — generator assembly", () => {
    const projectPanels = extractProjectPanels(Buffer.from(sampleXml, "utf8"));
    const { buffer, panelCount } = buildAssemblyGlbFromProject(projectPanels, sampleAssembly);
    assert.equal(panelCount, 2);
    assert.equal(readPreviewLayoutFromGlb(buffer), "assembly");
  });

  it("ENVER3 roundtrip у .b3d", () => {
    const bz85 = Buffer.concat([Buffer.from("BZ85"), Buffer.alloc(64)]);
    const patched = appendEnverAssemblyToB3d(bz85, sampleAssembly);
    const parsed = extractEnverAssemblyFromB3d(patched);
    assert.equal(parsed.panels.length, 2);
    assert.equal(parsed.panels[0].code, "10");
  });

  it("extractPackagePreviewGlb будує збірку з ENVER3 + .project", () => {
    const bz85 = Buffer.concat([Buffer.from("BZ85"), Buffer.alloc(64)]);
    const patched = appendEnverAssemblyToB3d(bz85, sampleAssembly);
    const result = extractPackagePreviewGlb({
      b3dBuffer: patched,
      projectBuffer: Buffer.from(sampleXml, "utf8")
    });
    assert.equal(result.layout, "assembly");
    assert.equal(result.source, "b3d_enver3_assembly");
    assert.equal(result.panelCount, 2);
    assert.equal(readPreviewLayoutFromGlb(result.buffer), "assembly");
  });

  it("parseAssemblyExportJson нормалізує код", () => {
    const data = parseAssemblyExportJson(
      JSON.stringify({
        panels: [
          {
            code: "010",
            centerMm: [0, 0, 0],
            axisX: [1, 0, 0],
            axisY: [0, 1, 0],
            axisZ: [0, 0, 1]
          }
        ]
      })
    );
    assert.equal(data.panels[0].code, "10");
  });

  it("preview3dLayout розпізнає assembly з preview_layout автопревʼю", () => {
    const detail = {
      files: [
        { kind: "glb_model", original_name: "3d-preview.glb", preview_layout: "assembly" },
        { kind: "b3d", original_name: "wardrobe.b3d" }
      ]
    };
    assert.equal(preview3dLayout(detail), "assembly");
  });

  it("layoutAssemblyPanels — мʼяке зіставлення за назвою", () => {
    const projectPanels = extractProjectPanels(
      Buffer.from(
        `<?xml version="1.0"?><project><part code="10" name="Стійка 10" dl="500" dw="300"/></project>`,
        "utf8"
      )
    );
    const assembly = {
      panels: [
        {
          code: "99",
          name: "Деталь 10",
          centerMm: [250, 150, 500],
          sizeMm: [500, 300, 18],
          axisX: [1, 0, 0],
          axisY: [0, 1, 0],
          axisZ: [0, 0, 1]
        }
      ]
    };
    const { panels, missing } = layoutAssemblyPanels(projectPanels, assembly);
    assert.equal(panels.length, 1);
    assert.deepEqual(missing, []);
  });

  it("buildMixedPreviewGlb — часткова збірка", () => {
    const projectPanels = extractProjectPanels(Buffer.from(sampleXml, "utf8"));
    const partialAssembly = {
      panels: [sampleAssembly.panels[0]]
    };
    const mixed = buildMixedPreviewGlb(projectPanels, partialAssembly);
    assert.equal(mixed.missingCodes.length, 1);
    assert.equal(mixed.assembledCount, 1);
    assert.equal(readPreviewLayoutFromGlb(mixed.buffer), "assembly");
  });

  it("layoutAssemblyPanels — зіставлення за розмірами", () => {
    const projectPanels = extractProjectPanels(
      Buffer.from(
        `<?xml version="1.0"?><project><part code="55" name="Полка" dl="800" dw="400"/></project>`,
        "utf8"
      )
    );
    const assembly = {
      panels: [
        {
          code: "999",
          centerMm: [400, 200, 450],
          sizeMm: [800, 400, 18],
          axisX: [1, 0, 0],
          axisY: [0, 1, 0],
          axisZ: [0, 0, 1]
        }
      ]
    };
    const { panels, missing } = layoutAssemblyPanels(projectPanels, assembly);
    assert.equal(panels.length, 1);
    assert.deepEqual(missing, []);
  });

  it("buildAssemblyExportFromScanPanels — center без DirX", () => {
    const exported = buildAssemblyExportFromScanPanels(
      {
        source: "bazis_b3d_decode",
        panels: [
          {
            code: "12",
            centerMm: [100, 200, 300],
            lengthMm: 500,
            widthMm: 300,
            thicknessMm: 18
          }
        ]
      },
      { productName: "Тест" }
    );
    assert.equal(exported.panels.length, 1);
    assert.deepEqual(exported.panels[0].axisX, [1, 0, 0]);
  });
});
