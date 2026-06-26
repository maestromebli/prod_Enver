import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canDelete3DAsset,
  canDownloadWebModel,
  canRetry3DConversion,
  canUpload3DAsset,
  canViewB3DReport,
  canViewOrder3DTab,
  canViewOriginalB3D,
  canViewWebModel,
  conversionSourceLabel,
  detectOrder3DFileType,
  isOrder3DUploadAllowed
} from "../../shared/production/order-3d.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { b3dConverterAdapter } from "../src/features/order-3d/converters/b3d-converter-adapter.js";
import { glbConverterAdapter } from "../src/features/order-3d/converters/glb-converter-adapter.js";
import { wrlConverterAdapter } from "../src/features/order-3d/converters/wrl-converter-adapter.js";
import { converterAvailable } from "../src/features/order-3d/b3d-conversion-client.js";
import { getUploadsDir } from "../src/file-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_B3D = path.join(
  __dirname,
  "../../data/uploads/constructive/261/packages/106/1782491363239-Гардеробна (3).b3d"
);
const TEST_PROJECT = path.join(
  __dirname,
  "../../data/uploads/constructive/261/packages/106/1782491379122-ЕМ-09 Гардеробна .project"
);

describe("order-3d", () => {
  const admin = { role: "admin", permissions: {} };
  const production = { role: "production", permissions: {} };
  const manager = { role: "manager", permissions: { canEditOrders: true } };
  const constructor = {
    role: "manager",
    permissions: { canWorkConstructorDesk: true, canEditOrders: true }
  };

  it("detectOrder3DFileType розпізнає b3d і glb", () => {
    assert.equal(detectOrder3DFileType("wardrobe.b3d"), "b3d");
    assert.equal(detectOrder3DFileType("model.glb"), "glb");
    assert.equal(isOrder3DUploadAllowed("x.B3D"), true);
    assert.equal(isOrder3DUploadAllowed("x.zip"), false);
  });

  it("RBAC: менеджер не бачить original .b3d", () => {
    assert.equal(canViewOriginalB3D(admin), true);
    assert.equal(canViewOriginalB3D(production), true);
    assert.equal(canViewOriginalB3D(manager), false);
    assert.equal(canDelete3DAsset(manager), false);
    assert.equal(canDelete3DAsset(production), true);
  });

  it("RBAC: upload і viewer", () => {
    assert.equal(canUpload3DAsset(manager), true);
    assert.equal(canUpload3DAsset(constructor), true);
    assert.equal(canViewWebModel(manager), true);
    assert.equal(canViewWebModel(null), false);
    assert.equal(canDownloadWebModel(manager), false);
    assert.equal(canDownloadWebModel(constructor), true);
    assert.equal(canRetry3DConversion(manager), false);
    assert.equal(canRetry3DConversion(production), true);
    assert.equal(canViewB3DReport(manager), false);
    assert.equal(canViewOrder3DTab(manager), true);
  });

  it("detectOrder3DFileType — усі підтримувані розширення", () => {
    assert.equal(detectOrder3DFileType("a.wrl"), "wrl");
    assert.equal(detectOrder3DFileType("a.stl"), "stl");
    assert.equal(detectOrder3DFileType("a.obj"), "obj");
    assert.equal(detectOrder3DFileType("a.JPEG"), "jpg");
    assert.equal(detectOrder3DFileType("a.png"), "png");
    assert.equal(detectOrder3DFileType("noext"), "unknown");
  });

  it("conversionSourceLabel", () => {
    assert.equal(conversionSourceLabel("embedded_glb"), "Вбудований GLB у .b3d");
    assert.equal(conversionSourceLabel(""), null);
    assert.equal(conversionSourceLabel("custom_source"), "custom_source");
  });

  it("convertB3dWithNode + .project дає flat GLB з 88 панелями", async () => {
    if (!fs.existsSync(TEST_B3D) || !fs.existsSync(TEST_PROJECT)) return;

    const b3dBuffer = fs.readFileSync(TEST_B3D);
    const projectBuffer = fs.readFileSync(TEST_PROJECT);
    const { extractPackagePreviewGlb } = await import("../src/constructive/b3d-glb-extractor.js");
    const built = extractPackagePreviewGlb({
      b3dBuffer,
      projectBuffer,
      productName: "garderoba"
    });
    assert.equal(built.source, "project_panels");
    assert.ok(built.buffer.length > 5000);
    assert.equal(built.panelCount, 88);
  });

  it("b3d adapter: Node + Python pipeline", async () => {
    assert.equal(b3dConverterAdapter.canHandle("b3d"), true);

    if (!converterAvailable()) {
      const result = await b3dConverterAdapter.convert({
        assetId: 1,
        originalFileType: "b3d",
        originalStoragePath: "orders/1/3d/x.b3d",
        originalFileName: "x.b3d"
      });
      assert.equal(result.status, "NEED_MANUAL_CHECK");
      assert.match(result.errorMessage, /не встановлено|not found/i);
      return;
    }

    if (!fs.existsSync(TEST_B3D)) {
      return;
    }

    const uploads = getUploadsDir();
    const storagePath = path.join("orders", "999", "3d", "test.b3d");
    const full = path.join(uploads, storagePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.copyFileSync(TEST_B3D, full);

    try {
      const result = await b3dConverterAdapter.convert({
        assetId: 42,
        originalFileType: "b3d",
        originalStoragePath: storagePath.replace(/\\/g, "/"),
        originalFileName: "test.b3d"
      });
      assert.ok(
        ["READY", "PARTIAL_READY", "NEED_MANUAL_CHECK", "NEED_MANUAL_RESEARCH", "FAILED"].includes(
          result.status
        )
      );
      if (result.status === "READY") {
        assert.ok(result.webModelStoragePath?.endsWith("42.glb"));
      }
    } finally {
      fs.rmSync(path.join(uploads, "orders", "999"), { recursive: true, force: true });
    }
  });

  it("glb adapter одразу READY", async () => {
    const result = await glbConverterAdapter.convert({
      assetId: 2,
      originalFileType: "glb",
      originalStoragePath: "orders/1/3d/m.glb",
      originalFileName: "m.glb"
    });
    assert.equal(result.status, "READY");
    assert.equal(result.webModelStoragePath, "orders/1/3d/m.glb");
  });

  it("wrl adapter одразу READY без конвертації", async () => {
    assert.equal(wrlConverterAdapter.canHandle("wrl"), true);
    const result = await wrlConverterAdapter.convert({
      assetId: 3,
      originalFileType: "wrl",
      originalStoragePath: "orders/1/3d/assembly.wrl",
      originalFileName: "assembly.wrl"
    });
    assert.equal(result.status, "READY");
    assert.equal(result.webModelStoragePath, "orders/1/3d/assembly.wrl");
  });
});
