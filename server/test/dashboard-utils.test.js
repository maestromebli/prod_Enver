import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickInstallSoon } from "../../client/src/dashboard.js";

describe("dashboard utils", () => {
  it("pickInstallSoon сортує ISO та UA дати хронологічно", () => {
    const positions = [
      { id: 1, orderNumber: "E-2", installDate: "28.05.2026", positionStatus: "У виробництві" },
      { id: 2, orderNumber: "E-1", installDate: "2026-05-26", positionStatus: "У виробництві" },
      { id: 3, orderNumber: "E-3", installDate: "27.05.2026", positionStatus: "У виробництві" }
    ];

    const result = pickInstallSoon(positions, 3);
    assert.deepEqual(
      result.map((p) => p.id),
      [2, 3, 1]
    );
  });

  it("pickInstallSoon ставить позиції без валідної дати в кінець", () => {
    const positions = [
      { id: 10, orderNumber: "E-1", installDate: "", positionStatus: "Готово до встановлення" },
      {
        id: 11,
        orderNumber: "E-2",
        installDate: "26.05.2026",
        positionStatus: "Готово до встановлення"
      }
    ];

    const result = pickInstallSoon(positions, 2);
    assert.deepEqual(
      result.map((p) => p.id),
      [11, 10]
    );
  });
});
