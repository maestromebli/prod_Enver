import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeAddressFragment,
  resolveObjectName,
  resolveObjectNameFromOrders
} from "../../shared/production/object-display.js";

describe("object-display", () => {
  it("resolveObjectNameFromOrders знаходить замовлення за orderId", () => {
    const orders = [{ id: 5, orderNumber: "E-5", object: "Кухня Петренко" }];
    const name = resolveObjectNameFromOrders({ orderId: 5, object: "київ" }, orders);
    assert.equal(name, "Кухня Петренко");
  });

  it("looksLikeAddressFragment — вулиця", () => {
    assert.equal(looksLikeAddressFragment("вул. Хрещатик 1"), true);
    assert.equal(looksLikeAddressFragment("Офіс центр"), false);
  });

  it("resolveObjectName без order — позиція", () => {
    assert.equal(resolveObjectName({ object: "Шафа" }, null), "Шафа");
  });

  it("resolveObjectName — delivery збігається з object позиції", () => {
    const order = { object: "Проєкт А" };
    const position = { object: "м. Львів", deliveryAddress: "м. Львів" };
    assert.equal(resolveObjectName(position, order), "Проєкт А");
  });
});
