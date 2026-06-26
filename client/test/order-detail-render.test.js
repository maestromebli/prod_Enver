import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderProgress } from "../src/order-detail-render.js";

describe("order-detail-render", () => {
  it("orderProgress — середнє по робочих позиціях", () => {
    const order = { id: 1, orderNumber: "E-1" };
    const related = [
      { id: 10, orderId: 1, parentId: null, progress: 40 },
      { id: 11, orderId: 1, parentId: 10, progress: 80 }
    ];
    assert.equal(orderProgress(order, related), 80);
  });

  it("orderProgress без позицій — 0", () => {
    assert.equal(orderProgress({ id: 1 }, []), 0);
  });
});
