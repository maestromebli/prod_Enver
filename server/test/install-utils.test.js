import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getInstallScheduleCandidates,
  isInstallScheduleCandidate,
  positionInstallLabel
} from "../../client/src/install-utils.js";

describe("install-utils", () => {
  const positions = [
    {
      id: 1,
      orderNumber: "Е-2",
      item: "Кухня",
      object: "Об'єкт B",
      positionStatus: "Не розпочато",
      progress: 0
    },
    {
      id: 2,
      orderNumber: "Е-1",
      item: "Шафа",
      object: "Об'єкт A",
      positionStatus: "Готово до встановлення",
      progress: 100
    },
    {
      id: 3,
      orderNumber: "Е-3",
      item: "",
      object: "Об'єкт C",
      positionStatus: "У виробництві",
      progress: 40
    }
  ];

  it("isInstallScheduleCandidate accepts any position with id", () => {
    assert.equal(isInstallScheduleCandidate(positions[0]), true);
    assert.equal(isInstallScheduleCandidate({}), false);
  });

  it("getInstallScheduleCandidates includes new positions and sorts by order number", () => {
    const list = getInstallScheduleCandidates(positions);
    assert.deepEqual(
      list.map((p) => p.id),
      [2, 1, 3]
    );
  });

  it("getInstallScheduleCandidates keeps selected position in list", () => {
    const list = getInstallScheduleCandidates(positions, 3);
    assert.ok(list.some((p) => p.id === 3));
  });

  it("positionInstallLabel formats order, item and object", () => {
    assert.equal(positionInstallLabel(positions[0]), "Е-2 — Кухня (Об'єкт B)");
    assert.equal(
      positionInstallLabel({ id: 5, orderNumber: "", item: "", object: "" }),
      "Позиція #5"
    );
  });
});
