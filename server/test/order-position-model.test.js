import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPositionDisplayName,
  getPositionTabLabel,
  getRootPositions,
  getSubPositions,
  getWorkPositions,
  isRootPosition,
  isSinglePositionOrder,
  isSubPosition,
  isWorkPosition,
  shouldUseRootAsWorkPosition,
  workflowPositionsForOrders
} from "../../shared/production/order-position-model.js";
import {
  buildManagerDataFromRow,
  isManagerDataComplete,
  inferManagerFileKind,
  parseManagerDataJson
} from "../../shared/production/position-manager-data.js";

const order = { id: 1, orderNumber: "2026-001" };

const positionsWithSubs = [
  { id: 10, orderId: 1, parentId: null, item: "ЖК Ліпінка", itemType: "Інше" },
  { id: 11, orderId: 1, parentId: 10, item: "Кухня", itemType: "Зона" },
  { id: 12, orderId: 1, parentId: 10, item: "Шафа", itemType: "Зона" }
];

const singleRoot = [
  {
    id: 20,
    orderId: 2,
    orderNumber: "2026-002",
    parentId: null,
    item: "Квартира",
    itemType: "Замовлення"
  }
];

describe("order-position-model", () => {
  it("isRootPosition / isSubPosition", () => {
    assert.equal(isRootPosition(positionsWithSubs[0]), true);
    assert.equal(isSubPosition(positionsWithSubs[1]), true);
  });

  it("getWorkPositions returns subpositions when present", () => {
    const work = getWorkPositions(order, positionsWithSubs);
    assert.deepEqual(
      work.map((p) => p.id),
      [11, 12]
    );
  });

  it("getWorkPositions returns root when no subpositions", () => {
    const work = getWorkPositions({ id: 2, orderNumber: "2026-002" }, singleRoot);
    assert.deepEqual(
      work.map((p) => p.id),
      [20]
    );
  });

  it("isSinglePositionOrder", () => {
    assert.equal(isSinglePositionOrder(order, positionsWithSubs), false);
    assert.equal(isSinglePositionOrder({ id: 2 }, singleRoot), true);
  });

  it("shouldUseRootAsWorkPosition", () => {
    assert.equal(shouldUseRootAsWorkPosition(order, positionsWithSubs), false);
    assert.equal(shouldUseRootAsWorkPosition({ id: 2 }, singleRoot), true);
  });

  it("getSubPositions / getRootPositions", () => {
    assert.equal(getSubPositions(order, positionsWithSubs).length, 2);
    assert.equal(getRootPositions(order, positionsWithSubs).length, 1);
  });

  it("isWorkPosition", () => {
    assert.equal(isWorkPosition(positionsWithSubs[1], order, positionsWithSubs), true);
    assert.equal(isWorkPosition(positionsWithSubs[0], order, positionsWithSubs), false);
  });

  it("getPositionDisplayName / getPositionTabLabel", () => {
    assert.equal(getPositionDisplayName(positionsWithSubs[1]), "Кухня");
    assert.equal(getPositionTabLabel(positionsWithSubs[1], 0), "Кухня");
  });

  it("workflowPositionsForOrders — лише робочі sub-позиції", () => {
    const workflow = workflowPositionsForOrders([order], positionsWithSubs);
    assert.deepEqual(
      workflow.map((p) => p.id),
      [11, 12]
    );
  });
});

describe("position-manager-data", () => {
  it("parseManagerDataJson повертає дефолт", () => {
    const d = parseManagerDataJson(null);
    assert.ok(d.delivery);
    assert.ok(Array.isArray(d.appliances));
  });

  it("buildManagerDataFromRow з колонок", () => {
    const data = buildManagerDataFromRow({
      delivery_address: "вул. Тестова 1",
      position_deadline: "01.07.2026",
      manager_data_json: JSON.stringify({ comments: { client: "Без ручок" } })
    });
    assert.equal(data.delivery.address, "вул. Тестова 1");
    assert.equal(data.comments.client, "Без ручок");
  });

  it("isManagerDataComplete", () => {
    const complete = isManagerDataComplete(
      { item: "Кухня" },
      {
        delivery: { address: "Адреса" },
        deadlines: { positionDeadline: "01.07.2026" }
      }
    );
    assert.equal(complete, true);
    assert.equal(
      isManagerDataComplete({ item: "Кухня" }, { delivery: { address: "" }, deadlines: {} }),
      false
    );
  });

  it("inferManagerFileKind визначає тип за MIME та ім'ям", () => {
    assert.equal(inferManagerFileKind("photo.jpg", "image/jpeg"), "manager_photo");
    assert.equal(inferManagerFileKind("plan.pdf", "application/pdf"), "manager_pdf");
    assert.equal(inferManagerFileKind("заміри_кухні.xlsx", ""), "manager_measurement");
    assert.equal(inferManagerFileKind("документ.docx", ""), "manager_other");
  });
});
