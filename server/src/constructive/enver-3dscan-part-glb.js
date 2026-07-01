import { buildPreviewGlbFromPanels } from "./project-glb-builder.js";
import { fuseBazisPackage } from "./enver-3dscan-fusion.js";
import { findEnver3dscanJsonFileRow } from "./b3d-auto-3dscan.js";
import { getPackageFiles } from "./constructive-package-service.js";
import { readStoredFile } from "../file-storage.js";
import {
  findScanPanelForPart,
  layoutScanPanelForDetail
} from "../../../shared/production/enver-3dscan-part-layout.js";

function pkgStoragePath(file) {
  return file?.storage_path || file?.storagePath || "";
}

function pkgOriginalName(file) {
  return file?.original_name || file?.originalName || "";
}

/** Завантажити fusion-контекст пакета для побудови моделі деталі. */
export async function fusePackageScan(packageId) {
  const fileRows = await getPackageFiles(packageId);
  const b3dFile = fileRows.find((f) => f.kind === "b3d");
  const projectFile = fileRows.find((f) => f.kind === "project");
  const assemblyFile = fileRows.find(
    (f) =>
      f.kind === "other" &&
      (pkgOriginalName(f) === "enver-assembly.json" ||
        pkgOriginalName(f).toLowerCase().endsWith(".enver-assembly.json"))
  );
  const scanFile = findEnver3dscanJsonFileRow(fileRows);

  const [b3dBuffer, projectBuffer, assemblyBuffer, scanBuffer] = await Promise.all([
    b3dFile ? readStoredFile(pkgStoragePath(b3dFile)) : null,
    projectFile ? readStoredFile(pkgStoragePath(projectFile)) : null,
    assemblyFile ? readStoredFile(pkgStoragePath(assemblyFile)) : null,
    scanFile ? readStoredFile(pkgStoragePath(scanFile)) : null
  ]);

  return fuseBazisPackage({
    b3dBuffer,
    projectBuffer,
    scanJsonBuffer: scanBuffer?.length
      ? scanBuffer
      : assemblyBuffer?.length
        ? assemblyBuffer
        : null,
    productName: pkgOriginalName(b3dFile).replace(/\.b3d$/i, "") || ""
  });
}

/** GLB однієї деталі з панелі ENVER_3dscan (або розмірів part). */
export function buildPartDetailGlbFromScanPanel(panel, { part = null, productName = "" } = {}) {
  const laidOut = layoutScanPanelForDetail(panel, part);
  const built = buildPreviewGlbFromPanels([laidOut], {
    productName: productName || laidOut.partName || `panel-${laidOut.code}`,
    previewLayout: "part_detail"
  });
  return {
    buffer: built.buffer,
    meshName: panel.meshName || `panel-${laidOut.code}`,
    panelCount: 1,
    code: laidOut.code
  };
}

/** GLB деталі за fusion + constructive_parts. */
export async function buildPartDetailGlbForPart(packageId, part) {
  const fused = await fusePackageScan(packageId);
  const panel = findScanPanelForPart(fused.scan, part);
  const productName = fused.scan?.productName || part?.partName || "";

  if (panel) {
    return {
      ...buildPartDetailGlbFromScanPanel(panel, { part, productName }),
      source: "enver_3dscan_panel"
    };
  }

  const fallbackPanel = {
    code: part.partNo || part.part_no || part.partCode || part.part_code,
    name: part.partName || part.part_name,
    lengthMm: Number(part.length) || 0,
    widthMm: Number(part.width) || 0,
    thicknessMm: Number(part.thickness) || 18,
    meshName: part.modelMeshName || part.model_mesh_name || `panel-${part.partNo || part.part_no}`
  };

  return {
    ...buildPartDetailGlbFromScanPanel(fallbackPanel, { part, productName }),
    source: "part_dimensions"
  };
}
