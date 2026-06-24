import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsSecret,
  isPositiveLearningEvent,
  sanitizeLearningText
} from "../src/ai/ai-memory.js";
import { buildLearningSummary } from "../src/ai/ai-learning.js";
import { combinedSimilarity, itemNameSimilarity } from "../src/ai/similarity.js";

describe("ai-memory sanitize", () => {
  it("виявляє секрети", () => {
    assert.equal(containsSecret("sk-proj-abc123def456ghi789jkl"), true);
    assert.equal(containsSecret("звичайний текст"), false);
  });

  it("sanitizeLearningText відкидає секрети", () => {
    assert.equal(sanitizeLearningText("ключ sk-proj-abc123def456ghi789jkl"), "");
    assert.equal(sanitizeLearningText("перевірити drilling"), "перевірити drilling");
  });

  it("bad rating не позитивний приклад", () => {
    assert.equal(isPositiveLearningEvent("bad"), false);
    assert.equal(isPositiveLearningEvent("good"), true);
    assert.equal(isPositiveLearningEvent("partial"), true);
  });
});

describe("ai-learning similarity", () => {
  it("схожі назви виробів", () => {
    assert.ok(itemNameSimilarity("Шафа-купе", "шафа купе") > 0.5);
  });

  it("combinedSimilarity для шафи", () => {
    const score = combinedSimilarity(
      { itemName: "Шафа-купе", itemType: "шафа", material: "ДСП" },
      { item_name: "Шафа купе 2400", item_type: "шафа", material: "ДСП 18" }
    );
    assert.ok(score > 0.4);
  });

  it("buildLearningSummary з повторюваними drilling", () => {
    const events = [
      {
        rating: "good",
        itemType: "шафа",
        itemName: "Шафа",
        correctionText: "",
        aiOutput: { suggestedTasks: [{ stage: "cutting" }, { stage: "edging" }] },
        correctedOutput: { suggestedTasks: ["cutting", "edging", "drilling"] }
      },
      {
        rating: "partial",
        itemType: "шафа",
        itemName: "Шафа 2",
        correctionText: "",
        aiOutput: { suggestedTasks: [{ stage: "cutting" }] },
        correctedOutput: { suggestedTasks: ["cutting", "drilling"] }
      },
      {
        rating: "good",
        itemType: "шафа",
        itemName: "Шафа 3",
        correctionText: "",
        aiOutput: { suggestedTasks: [{ stage: "cutting" }] },
        correctedOutput: { suggestedTasks: ["cutting", "drilling"] }
      }
    ];
    const summary = buildLearningSummary(events);
    assert.ok(summary.includes("drilling") || summary.includes("присад"));
  });
});
