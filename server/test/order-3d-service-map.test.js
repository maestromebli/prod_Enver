import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOrder3DAssetRow } from "../src/features/order-3d/order-3d-service.js";

describe("mapOrder3DAssetRow", () => {
  const admin = { id: 1, role: "admin", permissions: {} };
  const manager = { id: 2, role: "manager", permissions: { canEditOrders: true } };

  const baseRow = {
    id: 10,
    order_id: 5,
    original_file_name: "model.b3d",
    original_file_type: "b3d",
    original_storage_path: "orders/5/3d/1-model.b3d",
    web_model_storage_path: "orders/5/3d/1-model.glb",
    preview_storage_path: "orders/5/3d/preview.png",
    report_storage_path: "orders/5/3d/report.json",
    status: "READY",
    error_message: null,
    conversion_source: "project_panels",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z"
  };

  it("null для порожнього рядка", () => {
    assert.equal(mapOrder3DAssetRow(null, admin), null);
  });

  it("admin бачить original URL і report", () => {
    const mapped = mapOrder3DAssetRow(baseRow, admin, { orderId: 5 });
    assert.equal(mapped.originalFileUrl, "/api/orders/5/3d/10/original");
    assert.equal(mapped.reportUrl, "/api/orders/5/3d/10/report");
    assert.equal(mapped.conversionSourceLabel, "Розкладка деталей з .project");
    assert.equal(mapped.permissions.canViewOriginal, true);
    assert.equal(mapped.permissions.canDelete, true);
  });

  it("менеджер не бачить original .b3d", () => {
    const mapped = mapOrder3DAssetRow(baseRow, manager, { orderId: 5 });
    assert.equal(mapped.originalFileUrl, null);
    assert.equal(mapped.reportUrl, null);
    assert.equal(mapped.permissions.canViewOriginal, false);
    assert.equal(mapped.permissions.canDelete, false);
  });

  it("PARTIAL_READY і conversionHint", () => {
    const mapped = mapOrder3DAssetRow(
      {
        ...baseRow,
        status: "PARTIAL_READY",
        error_message: "Fallback GLB",
        conversion_source: "python_b3d_converter"
      },
      admin,
      { orderId: 5 }
    );
    assert.equal(mapped.isPartialGeometry, true);
    assert.equal(mapped.conversionHint, "Fallback GLB");
    assert.equal(mapped.conversionSourceLabel, "Python B3D-парсер (research)");
  });

  it("webModelFormat з шляху .wrl", () => {
    const mapped = mapOrder3DAssetRow(
      {
        ...baseRow,
        web_model_storage_path: "orders/5/3d/assembly.wrl",
        original_file_type: "wrl"
      },
      manager,
      { orderId: 5 }
    );
    assert.equal(mapped.webModelFormat, "wrl");
    assert.equal(mapped.webModelUrl, "/api/orders/5/3d/10/web-model");
    assert.equal(mapped.previewLayout, "assembly");
  });

  it("previewLayout і upgradeHint для flat", () => {
    const mapped = mapOrder3DAssetRow(
      {
        ...baseRow,
        status: "PARTIAL_READY",
        conversion_source: "project_panels"
      },
      admin,
      { orderId: 5 }
    );
    assert.equal(mapped.previewLayout, "flat");
    assert.equal(mapped.previewLayoutLabel, "Розкладка деталей");
    assert.ok(mapped.upgradeHint);
  });

  it("previewLayout assembly для ENVER3", () => {
    const mapped = mapOrder3DAssetRow(
      {
        ...baseRow,
        conversion_source: "b3d_enver3_assembly"
      },
      admin,
      { orderId: 5 }
    );
    assert.equal(mapped.previewLayout, "assembly");
    assert.equal(mapped.upgradeHint, null);
  });
});
