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

  it("validateWorkspacePayload вимагає LED лише з галочкою", () => {
    const position = {
      manager_data_json: JSON.stringify({ requirements: { needsLed: true } })
    };
    const errors = validateWorkspacePayload(parseWorkspaceJson("{}"), position);
    assert.ok(errors.some((e) => e.includes("напругу")));
    assert.ok(errors.some((e) => e.includes("колір")));

    const noLed = validateWorkspacePayload(parseWorkspaceJson("{}"), {
      manager_data_json: JSON.stringify({ requirements: { needsLed: false } })
    });
    assert.equal(noLed.length, 0);
  });

  it("validateWorkspacePayload вимагає техніку лише з галочкою", () => {
    const ws = parseWorkspaceJson(
      JSON.stringify({ ledLighting: { voltage: "24", color: "3000K" } }),
      { item: "Кухня" }
    );
    const kitchenNoFlag = validateWorkspacePayload(ws, {
      item: "Кухня",
      manager_data_json: JSON.stringify({ requirements: { needsTech: false } })
    });
    assert.equal(kitchenNoFlag.length, 0);

    const withFlag = validateWorkspacePayload(ws, {
      item: "Кухня",
      manager_data_json: JSON.stringify({ requirements: { needsTech: true } })
    });
    assert.ok(withFlag.some((e) => e.includes("техніка")));
  });

  it("workspaceCompletion рахує відсоток без LED/техніки без галочок", () => {
    const ws = { isKitchen: true, ledLighting: { voltage: "", color: "" } };
    const files = [{ kind: "measurements" }, { kind: "manager_image" }];
    const c = workspaceCompletion(ws, files, {
      manager_data_json: JSON.stringify({ requirements: { needsTech: false, needsLed: false } })
    });
    assert.equal(c.ledOk, null);
    assert.equal(c.techOk, null);
    assert.equal(c.percent, 100);
  });

  it("workspaceCompletion враховує LED і техніку з галочками", () => {
    const ws = {
      ledLighting: { voltage: "220", color: "білий" },
      techLink: "https://example.com/oven"
    };
    const files = [{ kind: "measurements" }, { kind: "manager_image" }];
    const c = workspaceCompletion(ws, files, {
      manager_data_json: JSON.stringify({ requirements: { needsTech: true, needsLed: true } })
    });
    assert.equal(c.ledOk, true);
    assert.equal(c.techOk, true);
    assert.equal(c.percent, 100);
  });

  it("suggestConstructorTiming дає більше годин для кухні", () => {
    const kitchen = suggestConstructorTiming(
      { item: "Кухня", itemType: "кухня" },
      { childCount: 2 }
    );
    const shelf = suggestConstructorTiming({ item: "Шафа", itemType: "шафа" }, { childCount: 0 });
    assert.ok(kitchen.estimatedHours > shelf.estimatedHours);
    assert.ok(kitchen.dueAt);
  });
});
