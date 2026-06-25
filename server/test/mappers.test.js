import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { positionToDb } from "../src/mappers.js";

describe("positionToDb", () => {
  it("не падає, якщо поле constructor відсутнє в тілі запиту", () => {
    const row = positionToDb({
      item: "Вітальня",
      orderNumber: "Е-40",
      orderId: 1,
      itemType: "Зона"
    });
    assert.equal(row.constructor_name, "");
    assert.equal(row.item, "Вітальня");
  });

  it("читає constructor, якщо воно явно передане", () => {
    const row = positionToDb({
      item: "Кухня",
      orderNumber: "Е-40",
      constructor: "  Іван  "
    });
    assert.equal(row.constructor_name, "Іван");
  });
});
