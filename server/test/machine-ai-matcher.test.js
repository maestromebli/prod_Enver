import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates } from "../src/machine-ai-matcher.js";

describe("machine-ai-matcher heuristic", () => {
  it("ранжує позицію за збігом номера замовлення", () => {
    const parsed = {
      jobRef: "EN-2405",
      programName: "",
      tokens: ["en", "2405", "kitchen"]
    };
    const candidates = [
      { id: 1, order_number: "EN-2405-01", object: "вул. Хрещатик", item: "Кухня", item_type: "" },
      { id: 2, order_number: "EN-9999", object: "інше", item: "Шафа", item_type: "" }
    ];
    const ranked = rankCandidates(parsed, candidates);
    assert.equal(ranked[0].row.id, 1);
    assert.ok(ranked[0].score > ranked[1].score);
  });
});
