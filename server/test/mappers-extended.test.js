import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOrder, mapPosition, orderToDb, positionToDb } from "../src/mappers.js";

describe("mapOrder", () => {
  it("мапить рядок БД у API-модель", () => {
    const mapped = mapOrder({
      id: 5,
      order_number: "Е-100",
      object: "Кухня",
      client: "Клієнт",
      manager: "Менеджер",
      default_delivery_address: "вул. 1",
      start_date: "2026-01-01",
      plan_date: "2026-02-01",
      status: "Передано",
      priority: "Високий",
      comment: "комент",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z"
    });
    assert.equal(mapped.orderNumber, "Е-100");
    assert.equal(mapped.defaultDeliveryAddress, "вул. 1");
    assert.equal(mapped.status, "Передано");
  });

  it("null для порожнього вводу", () => {
    assert.equal(mapOrder(null), null);
  });
});

describe("mapPosition", () => {
  it("мапить позицію з конструктивом і пакетом", () => {
    const mapped = mapPosition({
      id: 10,
      parent_id: 9,
      order_id: 5,
      order_number: "Е-100",
      item: "Шафа",
      has_constructive_file: true,
      constructive_file_name: "plan.pdf",
      constructive_file_count: 2,
      has_constructive_package: true,
      constructive_package_id: 3,
      constructive_package_version: 2,
      constructive_parts_count: 12,
      cutting_status: "В роботі",
      current_stage: "cutting",
      progress: 40,
      constructor_name: "Петро"
    });
    assert.equal(mapped.parentId, 9);
    assert.equal(mapped.hasConstructiveFile, true);
    assert.equal(mapped.constructiveFileCount, 2);
    assert.equal(mapped.hasConstructivePackage, true);
    assert.equal(mapped.constructor, "Петро");
    assert.equal(mapped.currentStage, "cutting");
  });
});

describe("orderToDb", () => {
  it("clientAddress як fallback для default_delivery_address", () => {
    const row = orderToDb({
      orderNumber: " Е-1 ",
      object: " Об'єкт ",
      clientAddress: " адреса "
    });
    assert.equal(row.order_number, "Е-1");
    assert.equal(row.default_delivery_address, "адреса");
  });
});

describe("positionToDb extended", () => {
  it("зберігає числові id і assemblyResponsible", () => {
    const row = positionToDb({
      parentId: 1,
      orderId: 2,
      orderNumber: "Е-1",
      item: "Зона",
      assemblyResponsible: " Олег "
    });
    assert.equal(row.parent_id, 1);
    assert.equal(row.order_id, 2);
    assert.equal(row.assembly_responsible, "Олег");
  });
});
