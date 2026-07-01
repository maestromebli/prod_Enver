import fs from "node:fs/promises";
import { readStoredFile, resolveStoredPath } from "../file-storage.js";
import { computeChecksum } from "./part-code.js";
import {
  appendEnver3dscanToB3d,
  extractEnver3dscanFromB3d,
  isEnver3dscanSidecarName,
  parseEnver3dscanJson
} from "../../../shared/production/enver-3dscan.js";
import { fuseBazisPackage } from "./enver-3dscan-fusion.js";
import { run } from "../db.js";

export { isEnver3dscanSidecarName };

export function findEnver3dscanJsonFileRow(fileRows = []) {
  return (
    fileRows.find(
      (f) => f.kind === "other" && isEnver3dscanSidecarName(f.original_name || f.originalName || "")
    ) || null
  );
}

export async function loadEnver3dscanFromJsonBuffer(jsonBuffer) {
  if (!jsonBuffer?.length) return null;
  try {
    return parseEnver3dscanJson(jsonBuffer.toString("utf8"));
  } catch {
    return null;
  }
}

export async function buildPatchedB3dWithEnver3dscan(b3dBuffer, scanDocument) {
  if (!b3dBuffer?.length || !scanDocument?.panels?.length) return null;
  if (extractEnver3dscanFromB3d(b3dBuffer)) {
    return {
      buffer: b3dBuffer,
      alreadyPresent: true,
      panelCount: scanDocument.panels.length
    };
  }
  return {
    buffer: appendEnver3dscanToB3d(b3dBuffer, scanDocument),
    alreadyPresent: false,
    panelCount: scanDocument.panels.length
  };
}

export async function overwritePackageFileBuffer(fileRow, buffer) {
  if (!fileRow?.storage_path && !fileRow?.storagePath) {
    throw new Error("Немає storage_path для файлу пакета");
  }
  const storagePath = fileRow.storage_path || fileRow.storagePath;
  const full = resolveStoredPath(storagePath);
  await fs.writeFile(full, buffer);
  const checksum = computeChecksum(buffer);
  await run(
    `UPDATE constructive_package_files
     SET size_bytes = $2, checksum = $3
     WHERE id = $1`,
    [fileRow.id, buffer.length, checksum]
  );
  return { storagePath, size: buffer.length, checksum };
}

/** Побудувати ENVER_3dscan з .b3d + .project без sidecar JSON (еквівалент скрипта Базіс). */
export function deriveScanDocumentFromPackage({ b3dBuffer = null, projectBuffer = null } = {}) {
  if (!b3dBuffer?.length && !projectBuffer?.length) return null;
  const fused = fuseBazisPackage({ b3dBuffer, projectBuffer });
  return fused.scan?.panels?.length ? fused.scan : null;
}

/** Дописати ENVER_3dscan у .b3d з sidecar JSON або з .project + .b3d, якщо хвоста ще немає. */
export async function autoSyncEnver3dscanToPackageB3d({ fileRows = [] } = {}) {
  const b3dRow = fileRows.find((f) => f.kind === "b3d");
  const b3dPath = b3dRow?.storage_path || b3dRow?.storagePath;
  if (!b3dPath) {
    return { applied: false, reason: "no_b3d" };
  }

  let b3dBuffer = await readStoredFile(b3dPath);
  if (extractEnver3dscanFromB3d(b3dBuffer)) {
    return { applied: false, reason: "already_has_enver_3dscan" };
  }

  let scanDocument = null;
  let syncReason = "enver_3dscan_appended_from_json";

  const scanRow = findEnver3dscanJsonFileRow(fileRows);
  const scanPath = scanRow?.storage_path || scanRow?.storagePath;
  if (scanPath) {
    scanDocument = await loadEnver3dscanFromJsonBuffer(await readStoredFile(scanPath));
    if (!scanDocument?.panels?.length) {
      return { applied: false, reason: "empty_3dscan_json" };
    }
  } else {
    const projectRow = fileRows.find((f) => f.kind === "project");
    const projectPath = projectRow?.storage_path || projectRow?.storagePath;
    if (!projectPath) {
      return { applied: false, reason: "no_3dscan_source" };
    }
    const projectBuffer = await readStoredFile(projectPath);
    scanDocument = deriveScanDocumentFromPackage({ b3dBuffer, projectBuffer });
    if (!scanDocument?.panels?.length) {
      return { applied: false, reason: "empty_3dscan_derived" };
    }
    syncReason = "enver_3dscan_derived_from_package";
  }

  const patched = await buildPatchedB3dWithEnver3dscan(b3dBuffer, scanDocument);
  if (!patched || patched.alreadyPresent) {
    return { applied: false, reason: "already_has_enver_3dscan", panelCount: patched?.panelCount };
  }

  await overwritePackageFileBuffer(b3dRow, patched.buffer);
  return {
    applied: true,
    panelCount: patched.panelCount,
    reason: syncReason
  };
}
