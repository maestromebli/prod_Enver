import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeParseResults } from "../src/constructive/parsers/index.js";
import { renderBarcodeSvg, renderQrSvg } from "../src/constructive/barcode.js";
import { renderPartLabelsHtml } from "../src/constructive/labels.js";

describe("mergeParseResults", () => {
  it("об'єднує матеріали і warnings", () => {
    const merged = mergeParseResults([
      {
        materials: ["ДСП"],
        parts: [{ partNo: "1", blockCode: "A" }],
        warnings: ["w1"],
        extractionQuality: "good",
        orderNumber: "Е-1"
      },
      {
        materials: ["ДСП", "МДФ"],
        hardware: ["петля"],
        parts: [{ partNo: "2" }],
        warnings: ["w1", "w2"],
        extractionQuality: "partial",
        modelReadiness: { has3dSource: true }
      }
    ]);
    assert.deepEqual(merged.materials, ["ДСП", "ДСП", "МДФ"]);
    assert.equal(merged.orderNumber, "Е-1");
    assert.equal(merged.extractionQuality, "partial");
    assert.equal(merged.modelReadiness.has3dSource, true);
    assert.ok(merged.manifestNodes.length >= 2);
  });

  it("worst quality poor перемагає", () => {
    const merged = mergeParseResults([
      { extractionQuality: "good", warnings: [] },
      { extractionQuality: "poor", warnings: [] }
    ]);
    assert.equal(merged.extractionQuality, "poor");
  });
});

describe("parsePackageFiles", () => {
  it("розбирає файли паралельно", async () => {
    const { parsePackageFiles } = await import("../src/constructive/parsers/index.js");
    const started = [];
    const readFile = async (path) => {
      started.push(path);
      await new Promise((r) => setTimeout(r, 30));
      return Buffer.from("x");
    };
    const rows = [
      { storage_path: "a.bin", mime: "", original_name: "a.bin", kind: "unknown_kind" },
      { storage_path: "b.bin", mime: "", original_name: "b.bin", kind: "unknown_kind" }
    ];
    const t0 = Date.now();
    const results = await parsePackageFiles(rows, readFile);
    const elapsed = Date.now() - t0;
    assert.equal(results.length, 2);
    assert.deepEqual(started.sort(), ["a.bin", "b.bin"]);
    assert.ok(elapsed < 55, `очікували паралельний розбір, отримали ${elapsed}ms`);
  });
});

describe("parsePackageFile unsupported", () => {
  it("повертає poor для невідомого kind", async () => {
    const { parsePackageFile } = await import("../src/constructive/parsers/index.js");
    const r = await parsePackageFile({
      buffer: Buffer.from(""),
      mime: "text/plain",
      originalName: "unknown.xyz",
      kind: "unknown_kind"
    });
    assert.equal(r.extractionQuality, "poor");
    assert.ok(r.warnings[0].includes("unknown_kind"));
  });
});

describe("barcode / labels", () => {
  it("renderBarcodeSvg екранує XML", async () => {
    const svg = renderBarcodeSvg('<test&"');
    assert.match(svg, /&lt;test&amp;&quot;/);
    assert.match(svg, /role="img"/);
  });

  it("renderQrSvg повертає svg", async () => {
    const svg = await renderQrSvg("ENVER-1");
    assert.match(svg, /<svg/);
  });

  it("renderPartLabelsHtml містить деталі", async () => {
    const html = await renderPartLabelsHtml({
      position: { order_number: "Е-1", item: "Кухня" },
      parts: [
        {
          partNo: "1",
          blockCode: "A",
          partName: "Бік",
          length: 600,
          width: 400,
          thickness: 18,
          material: "ДСП",
          barcodeValue: "P-1",
          qrValue: "P-1"
        }
      ]
    });
    assert.match(html, /Е-1/);
    assert.match(html, /Бік/);
    assert.match(html, /P-1/);
  });
});
