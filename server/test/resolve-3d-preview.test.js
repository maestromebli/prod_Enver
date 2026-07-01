import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  order3dAssetLayout,
  get3dUpgradeHintText,
  resolve3dPreviewContext
} from "../../shared/production/resolve-3d-preview.js";

describe("resolve-3d-preview", () => {
  it("order3dAssetLayout: ENVER3 → assembly", () => {
    assert.equal(
      order3dAssetLayout({
        status: "READY",
        conversionSource: "b3d_enver3_assembly",
        webModelUrl: "/x"
      }),
      "assembly"
    );
  });

  it("order3dAssetLayout: project_panels → flat", () => {
    assert.equal(
      order3dAssetLayout({
        status: "PARTIAL_READY",
        conversionSource: "project_panels",
        isPartialGeometry: true,
        webModelUrl: "/x"
      }),
      "flat"
    );
  });

  it("order3dAssetLayout: wrl → assembly", () => {
    assert.equal(
      order3dAssetLayout({
        status: "READY",
        webModelFormat: "wrl",
        webModelUrl: "/x"
      }),
      "assembly"
    );
  });

  it("get3dUpgradeHintText: assembly → null", () => {
    assert.equal(get3dUpgradeHintText({ layout: "assembly" }), null);
  });

  it("get3dUpgradeHintText: flat → підказка ENVER3", () => {
    const hint = get3dUpgradeHintText({
      layout: "flat",
      packageDetail: { files: [{ kind: "b3d" }] }
    });
    assert.match(hint, /ENVER3|enver-b3d/);
  });

  it("resolve3dPreviewContext: order має пріоритет над пакетом", () => {
    const ctx = resolve3dPreviewContext({
      orderAsset: {
        status: "READY",
        webModelUrl: "/api/orders/1/3d/2/web-model",
        conversionSource: "b3d_enver3_assembly",
        webModelFormat: "glb"
      },
      packageDetail: {
        files: [{ kind: "glb_model", originalName: "3d-preview.glb", previewLayout: "flat" }],
        parts: [{ id: 1 }]
      },
      packageViewerUrl: "/api/positions/1/files/9"
    });
    assert.equal(ctx.source, "order_3d");
    assert.equal(ctx.layout, "assembly");
    assert.equal(ctx.available, true);
    assert.equal(ctx.upgradeHint, null);
  });

  it("resolve3dPreviewContext: preferConstructivePackage — пакет перед order-3d", () => {
    const ctx = resolve3dPreviewContext({
      preferConstructivePackage: true,
      orderAsset: {
        status: "READY",
        webModelUrl: "/api/orders/1/3d/2/web-model",
        conversionSource: "b3d_enver3_assembly",
        webModelFormat: "glb"
      },
      packageDetail: {
        files: [{ kind: "glb_model", originalName: "3d-preview.glb", previewLayout: "flat" }],
        parts: [{ id: 1 }]
      },
      packageViewerUrl: "/api/positions/1/files/9"
    });
    assert.equal(ctx.source, "constructive_package");
    assert.equal(ctx.modelUrl, "/api/positions/1/files/9");
    assert.equal(ctx.layout, "flat");
  });

  it("resolve3dPreviewContext: fallback на пакет", () => {
    const ctx = resolve3dPreviewContext({
      orderAsset: null,
      packageDetail: {
        files: [
          { kind: "b3d", originalName: "k.b3d" },
          { kind: "glb_model", originalName: "3d-preview.glb", previewLayout: "flat" }
        ]
      },
      packageViewerUrl: "/pkg.glb"
    });
    assert.equal(ctx.source, "constructive_package");
    assert.equal(ctx.layout, "flat");
    assert.equal(ctx.modelUrl, "/pkg.glb");
    assert.ok(ctx.upgradeHint);
  });
});
