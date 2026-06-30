import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTextFromBuffer } from "../src/ai/file-extraction.js";

function makeZip(files) {
  const parts = [];
  let offset = 0;
  const central = [];

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(content, "utf8");
    const local = Buffer.alloc(30 + nameBuf.length + dataBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(dataBuf.length, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    dataBuf.copy(local, 30 + nameBuf.length);

    const c = Buffer.alloc(46 + nameBuf.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0, 4);
    c.writeUInt16LE(0, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0, 14);
    c.writeUInt32LE(dataBuf.length, 16);
    c.writeUInt32LE(dataBuf.length, 20);
    c.writeUInt32LE(nameBuf.length, 24);
    c.writeUInt16LE(0, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt32LE(0, 36);
    c.writeUInt32LE(offset, 42);
    nameBuf.copy(c, 46);

    parts.push(local);
    central.push(c);
    offset += local.length;
  }

  const centralDir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, eocd]);
}

describe("extractTextFromBuffer", () => {
  it("читає TXT як good", async () => {
    const buf = Buffer.from("Матеріал: ДСП 18\nПанель 600x400", "utf8");
    const r = await extractTextFromBuffer(buf, "text/plain", "spec.txt");
    assert.equal(r.sourceType, "text");
    assert.equal(r.extractionQuality, "good");
    assert.ok(r.text.includes("ДСП"));
  });

  it("читає JSON", async () => {
    const buf = Buffer.from(JSON.stringify({ panels: [{ name: "A" }] }), "utf8");
    const r = await extractTextFromBuffer(buf, "application/json", "data.json");
    assert.ok(r.text.includes("panels"));
    assert.equal(r.sourceType, "text");
  });

  it("ZIP з XML всередині", async () => {
    const xml = `<root>${"<panel name='Бік' qty='2' size='600x400'/>".repeat(20)}</root>`;
    const zip = makeZip({
      "project/spec.xml": xml
    });
    const r = await extractTextFromBuffer(zip, "application/zip", "project.zip");
    assert.equal(r.sourceType, "zip");
    assert.ok(r.text.includes("spec.xml"));
    assert.ok(r.extractedFiles.includes("project/spec.xml"));
    assert.ok(["good", "partial"].includes(r.extractionQuality));
  });

  it("поганий ZIP — fallback без падіння", async () => {
    const r = await extractTextFromBuffer(Buffer.from("not a zip"), "application/zip", "bad.zip");
    assert.equal(r.sourceType, "zip");
    assert.equal(r.extractionQuality, "poor");
    assert.ok(r.warnings.length > 0);
  });

  it("PDF partial extraction", async () => {
    const pdfLike = Buffer.from(
      "%PDF-1.4\n1 0 obj\n(ДСП 18 мм панель 600x400) Tj\n(Крайка ПВХ) Tj",
      "latin1"
    );
    const r = await extractTextFromBuffer(pdfLike, "application/pdf", "doc.pdf");
    assert.equal(r.sourceType, "pdf");
    assert.ok(["partial", "poor", "good"].includes(r.extractionQuality));
  });

  it("DWG повертає попередження", async () => {
    const r = await extractTextFromBuffer(Buffer.from([0, 1, 2, 3]), "", "plan.dwg");
    assert.equal(r.sourceType, "dwg");
    assert.equal(r.extractionQuality, "poor");
    assert.ok(r.warnings.some((w) => /DXF\/PDF/i.test(w)));
  });

  it("DXF витягує текстові рядки", async () => {
    const dxf = `0
SECTION
2
ENTITIES
0
TEXT
8
Layer1
1
Панель 600x400
0
ENDSEC
`;
    const r = await extractTextFromBuffer(Buffer.from(dxf, "utf8"), "", "part.dxf");
    assert.equal(r.sourceType, "dxf");
    assert.ok(r.text.includes("Панель") || r.text.includes("Layer1"));
  });

  it("читає .project XML", async () => {
    const xml = `<?xml version="1.0"?><project><part code="10" name="Стійка" dl="720" dw="560"/></project>`;
    const r = await extractTextFromBuffer(Buffer.from(xml, "utf8"), "", "kitchen.project");
    assert.equal(r.sourceType, "project");
    assert.ok(r.text.includes("Стійка"));
    assert.ok(["good", "partial"].includes(r.extractionQuality));
  });

  it("читає ENVER3 з .b3d", async () => {
    const { appendEnverAssemblyToB3d } =
      await import("../src/constructive/parsers/assembly-export.js");
    const b3d = Buffer.from("BZ85" + "x".repeat(20));
    const patched = appendEnverAssemblyToB3d(b3d, {
      version: 1,
      source: "bazis",
      panels: [
        {
          code: "10",
          name: "Стійка",
          centerMm: [1, 2, 3],
          sizeMm: [720, 560, 18],
          axisX: [1, 0, 0],
          axisY: [0, 1, 0],
          axisZ: [0, 0, 1]
        }
      ]
    });
    const r = await extractTextFromBuffer(patched, "", "model.b3d");
    assert.equal(r.sourceType, "b3d");
    assert.ok(r.text.includes("ENVER3"));
    assert.equal(r.extractionQuality, "good");
  });
});
