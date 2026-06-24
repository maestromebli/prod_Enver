import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLearningSummary } from "../src/ai/ai-learning.js";

describe("ai-learning", () => {
  it("порожні події — порожній summary", () => {
    assert.equal(buildLearningSummary([]), "");
  });

  it("одна подія не створює глобальний висновок", () => {
    const summary = buildLearningSummary([
      {
        rating: "good",
        itemType: "кухня",
        itemName: "Кухня",
        correctionText: "додати packaging note",
        aiOutput: {},
        correctedOutput: {}
      }
    ]);
    assert.equal(summary, "");
  });

  it("використовує correctionText як урок", () => {
    const summary = buildLearningSummary([
      {
        rating: "good",
        itemType: "шафа",
        itemName: "Шафа A",
        correctionText: "Завжди перевіряти drilling",
        aiOutput: {},
        correctedOutput: {}
      },
      {
        rating: "good",
        itemType: "шафа",
        itemName: "Шафа B",
        correctionText: "Завжди перевіряти drilling",
        aiOutput: {},
        correctedOutput: {}
      }
    ]);
    assert.ok(summary.includes("drilling"));
  });
});
