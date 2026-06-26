import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import {
  buildPreviewGlbFromProject,
  extractProjectPanels,
  isLegacySharedMeshPreviewGlb,
  layoutPreviewPanels
} from "../src/constructive/project-glb-builder.js";
import { decodeProjectText } from "../src/constructive/parsers/project-text.js";
import { manifestNodesFromProjectXml } from "../src/constructive/parsers/manifest-text.js";

describe("project-glb-builder", () => {
  const sampleXml = `<?xml version="1.0" encoding="windows-1251"?><project>
    <part id="1" code="10" name="Стійка" dl="1896.00" dw="540.00" count="1"/>
    <part id="2" code="11" name="Полиця" dl="800.00" dw="400.00" count="1"/>
    <operation code="0010x002x1" program="&lt;program dx=&quot;1896&quot; dy=&quot;540&quot; dz=&quot;18&quot;/&gt;"/>
  </project>`;

  it("витягує панелі за code з dl/dw", () => {
    const panels = extractProjectPanels(Buffer.from(sampleXml, "utf8"));
    assert.equal(panels.length, 2);
    assert.equal(panels[0].code, "10");
    assert.equal(panels[0].lengthMm, 1896);
    assert.equal(panels[0].widthMm, 540);
    assert.equal(panels[0].thicknessMm, 18);
  });

  it("будує валідний GLB з іменами вузлів = code", () => {
    const { buffer, panelCount } = buildPreviewGlbFromProject(Buffer.from(sampleXml, "utf8"));
    assert.equal(panelCount, 2);
    assert.equal(buffer.readUInt32LE(0), 0x46546c67);
    const jsonLen = buffer.readUInt32LE(12);
    const json = buffer.toString("utf8", 20, 20 + jsonLen).replace(/\0+$/, "");
    const gltf = JSON.parse(json);
    assert.equal(gltf.nodes.length, 2);
    assert.equal(gltf.meshes.length, 2);
    assert.deepEqual(gltf.nodes.map((n) => n.name).sort(), ["10", "11"]);
    assert.deepEqual(gltf.nodes.map((n) => n.mesh).sort(), [0, 1]);
    assert.equal(gltf.materials?.length, 1);
    assert.equal(isLegacySharedMeshPreviewGlb(buffer), false);
  });

  it("визначає застарілий GLB з одним спільним mesh", () => {
    const { buffer: fixed } = buildPreviewGlbFromProject(Buffer.from(sampleXml, "utf8"));
    assert.equal(isLegacySharedMeshPreviewGlb(fixed), false);

    const jsonLen = fixed.readUInt32LE(12);
    const gltf = JSON.parse(fixed.toString("utf8", 20, 20 + jsonLen).replace(/\0+$/, ""));
    gltf.meshes = [gltf.meshes[0]];
    gltf.nodes.forEach((node) => {
      node.mesh = 0;
    });

    const legacyJson = Buffer.from(JSON.stringify(gltf));
    const jsonPad = (legacyJson.length + 3) & ~3;
    const jsonChunk = Buffer.alloc(jsonPad);
    legacyJson.copy(jsonChunk);
    const binChunk = fixed.subarray(20 + jsonLen);
    const total = 12 + 8 + jsonPad + binChunk.length;
    const legacy = Buffer.alloc(total);
    let o = 0;
    legacy.writeUInt32LE(0x46546c67, o);
    o += 4;
    legacy.writeUInt32LE(2, o);
    o += 4;
    legacy.writeUInt32LE(total, o);
    o += 4;
    legacy.writeUInt32LE(jsonPad, o);
    o += 4;
    legacy.writeUInt32LE(0x4e4f534a, o);
    o += 4;
    jsonChunk.copy(legacy, o);
    o += jsonPad;
    binChunk.copy(legacy, o);

    assert.equal(isLegacySharedMeshPreviewGlb(legacy), true);
  });

  it("windows-1251 назви читаються", () => {
    const buf = Buffer.from(
      `<?xml version="1.0" encoding="windows-1251"?><part code="1" name="\xcf\xee\xeb" dl="100" dw="200"/>`,
      "binary"
    );
    const text = decodeProjectText(buf);
    const parsed = manifestNodesFromProjectXml(text);
    assert.equal(parsed.parts[0].partName, "Пол");
  });

  it("реальний .project (якщо є локально) дає панелі", () => {
    const path = "/Users/enver/Downloads/Telegram Desktop/ЕМ-09 Гардеробна .project";
    if (!fs.existsSync(path)) return;
    const panels = layoutPreviewPanels(extractProjectPanels(fs.readFileSync(path)));
    assert.ok(panels.length > 50);
    const glb = buildPreviewGlbFromProject(fs.readFileSync(path));
    assert.ok(glb.buffer.length > 1000);
  });
});
