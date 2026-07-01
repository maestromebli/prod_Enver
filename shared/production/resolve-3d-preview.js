import {
  findPackagePreview3dFile,
  has3dPreviewFile,
  hasB3dSourceFile,
  preview3dLayout,
  preview3dLayoutLabel,
  preview3dLoadFormat
} from "./constructive-package.js";

/** Джерела order-3d з повною збіркою. */
export const ORDER_3D_ASSEMBLY_SOURCES = new Set([
  "b3d_enver3_assembly",
  "b3d_enver3_only",
  "embedded_glb",
  "embedded_raw_glb"
]);

/** Джерела order-3d з плоскою розкладкою. */
export const ORDER_3D_FLAT_SOURCES = new Set([
  "project_panels",
  "b3d_xml_panels",
  "panel_preview",
  "python_b3d_converter"
]);

/** Тип layout для 3D-превʼю: повна збірка або розкладка деталей. */
export function order3dAssetLayout(asset) {
  if (!asset) return null;
  const src = String(asset.conversionSource || asset.conversion_source || "");
  const fmt = String(asset.webModelFormat || asset.web_model_format || "").toLowerCase();
  if (fmt === "wrl") return "assembly";
  if (ORDER_3D_ASSEMBLY_SOURCES.has(src)) return "assembly";
  if (ORDER_3D_FLAT_SOURCES.has(src)) return "flat";
  if (asset.status === "PARTIAL_READY" || asset.isPartialGeometry) return "flat";
  if (asset.status === "READY" && asset.webModelUrl) return "assembly";
  return null;
}

/**
 * Підказка для покращення 3D (текст без HTML).
 * @returns {string|null}
 */
export function get3dUpgradeHintText({ layout = null, packageDetail = null } = {}) {
  if (layout === "assembly") return null;

  const hasB3d = hasB3dSourceFile(packageDetail);
  const hasPreview = has3dPreviewFile(packageDetail);

  if (layout === "flat" || (hasPreview && layout !== "assembly")) {
    return "Для повної збірки: скрипт enver-b3d-assembly-export.js у Базіс (ENVER3) або експорт .wrl";
  }

  if (hasB3d && !hasPreview) {
    return "Додайте .project разом із .b3d — зʼявиться розкладка. Для збірки — ENVER3 або .wrl";
  }

  if (!hasPreview) {
    return "Завантажте .project + .b3d (GibLab) або .wrl (VRML з Базіс)";
  }

  return null;
}

/**
 * Єдине джерело правди: order-3d має пріоритет над пакетом конструктива.
 * @param {object} [params]
 * @param {object|null} [params.orderAsset]
 * @param {object|null} [params.packageDetail]
 * @param {string|null} [params.packageViewerUrl] - готовий URL для package-файлу (клієнт)
 */
export function resolve3dPreviewContext({
  orderAsset = null,
  packageDetail = null,
  packageViewerUrl = null
} = {}) {
  const orderReady =
    orderAsset &&
    (orderAsset.status === "READY" || orderAsset.status === "PARTIAL_READY") &&
    orderAsset.webModelUrl;

  const packageFile = packageDetail ? findPackagePreview3dFile(packageDetail) : null;
  const packageReady = Boolean(packageFile);

  let source = null;
  let format = null;
  let modelUrl = null;
  let layout = null;

  if (orderReady) {
    source = "order_3d";
    modelUrl = orderAsset.webModelUrl;
    format = orderAsset.webModelFormat || "glb";
    layout = order3dAssetLayout(orderAsset);
  } else if (packageReady) {
    source = "constructive_package";
    modelUrl = packageViewerUrl || null;
    format = preview3dLoadFormat(packageFile);
    layout = preview3dLayout(packageDetail);
  }

  if (!layout && packageReady) layout = preview3dLayout(packageDetail);

  return {
    available: Boolean(orderReady || packageReady),
    source,
    layout,
    layoutLabel: preview3dLayoutLabel(layout),
    format: format || "glb",
    modelUrl,
    packageFile: packageReady ? packageFile : null,
    parts: packageDetail?.parts || [],
    upgradeHint: get3dUpgradeHintText({ layout, packageDetail }),
    needsAssemblyUpgrade: layout === "flat"
  };
}
