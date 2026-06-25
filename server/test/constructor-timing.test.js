import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestConstructorTiming } from "../../shared/production/constructor-timing.js";

describe("constructor timing", () => {
  it("кухня довше за шафу", () => {
    const kitchen = suggestConstructorTiming(
      { item: "Кухня", itemType: "кухня" },
      { childCount: 2 }
    );
    const shelf = suggestConstructorTiming({ item: "Шафа", itemType: "шафа" }, { childCount: 0 });
    assert.ok(kitchen.estimatedHours > shelf.estimatedHours);
    assert.ok(kitchen.dueAt);
    assert.ok(kitchen.rationale);
  });

  it("файли менеджера зменшують оцінку", () => {
    const withFiles = suggestConstructorTiming(
      { item: "Шафа", itemType: "шафа" },
      { managerFilesCount: 3, managerPdfCount: 1 }
    );
    const without = suggestConstructorTiming({ item: "Шафа", itemType: "шафа" }, { managerFilesCount: 0 });
    assert.ok(withFiles.estimatedHours < without.estimatedHours);
  });

  it("повертає riskLevel", () => {
    const high = suggestConstructorTiming(
      { item: "Кухня", itemType: "кухня" },
      { managerFilesCount: 0 }
    );
    assert.equal(high.riskLevel, "high");
    const low = suggestConstructorTiming(
      { item: "Кухня", itemType: "кухня" },
      { managerFilesCount: 4, managerPdfCount: 2 }
    );
    assert.equal(low.riskLevel, "low");
  });
});
