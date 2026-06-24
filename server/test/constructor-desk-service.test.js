import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseWorkspaceJson,
  suggestConstructorTiming,
  validateWorkspacePayload,
  workspaceCompletion
} from "../src/constructor-desk-service.js";

describe("constructor desk service", () => {
  it("parseWorkspaceJson визначає кухню", () => {
    const ws = parseWorkspaceJson("{}", { item: "Кухня основна", itemType: "" });
    assert.equal(ws.isKitchen, true);
  });

  it("validateWorkspacePayload вимагає LED", () => {
    const errors = validateWorkspacePayload(parseWorkspaceJson("{}", { item: "Шафа" }), {
      item: "Шафа"
    });
    assert.ok(errors.some((e) => e.includes("напругу")));
    assert.ok(errors.some((e) => e.includes("колір")));
  });

  it("validateWorkspacePayload вимагає техніку для кухні", () => {
    const ws = parseWorkspaceJson(
      JSON.stringify({ isKitchen: true, ledLighting: { voltage: "24", color: "3000K" } }),
      { item: "Кухня" }
    );
    const errors = validateWorkspacePayload(ws, { item: "Кухня" });
    assert.ok(errors.some((e) => e.includes("техніка")));
  });

  it("workspaceCompletion рахує відсоток", () => {
    const ws = { isKitchen: false, ledLighting: { voltage: "220", color: "білий" } };
    const files = [{ kind: "measurements" }, { kind: "manager_image" }];
    const c = workspaceCompletion(ws, files);
    assert.equal(c.ledOk, true);
    assert.equal(c.percent, 100);
  });

  it("suggestConstructorTiming дає більше годин для кухні", () => {
    const kitchen = suggestConstructorTiming({ item: "Кухня", itemType: "кухня" }, 2);
    const shelf = suggestConstructorTiming({ item: "Шафа", itemType: "шафа" }, 0);
    assert.ok(kitchen.estimatedHours > shelf.estimatedHours);
    assert.ok(kitchen.dueAt);
  });
});
