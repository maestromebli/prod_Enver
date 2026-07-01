import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readScanStation } from "../src/routes/parts.js";

describe("parts scan station", () => {
  it("readScanStation бере station з body", () => {
    assert.equal(readScanStation({ body: { station: "cutting" } }), "cutting");
    assert.equal(readScanStation({ body: { station: "edging" } }), "edging");
  });

  it("readScanStation fallback на query і header", () => {
    assert.equal(readScanStation({ query: { station: "drilling" } }), "drilling");
    assert.equal(readScanStation({ headers: { "x-enver-station": "assembly" } }), "assembly");
  });

  it("scanPart body contract містить station", () => {
    const body = JSON.stringify({
      barcode: "0010X002X1",
      station: "cutting",
      positionId: 12,
      orderId: 3
    });
    const parsed = JSON.parse(body);
    assert.equal(parsed.station, "cutting");
    assert.equal(parsed.barcode, "0010X002X1");
  });
});
