import fs from "node:fs/promises";
import { readStoredFile, resolveStoredPath } from "../file-storage.js";
import { computeChecksum } from "./part-code.js";
import {
  appendEnverAssemblyToB3d,
  extractEnverAssemblyFromB3d,
  parseAssemblyExportJson
} from "./parsers/assembly-export.js";
import { run } from "../db.js";

const ASSEMBLY_JSON_NAMES = new Set([
  "enver-assembly.json",
  "assembly.json",
  "bazis-assembly.json"
]);

export function isEnverAssemblyJsonName(name = "") {
  const lower = String(name).toLowerCase();
  if (ASSEMBLY_JSON_NAMES.has(lower)) return true;
  return lower.endsWith(".enver-assembly.json");
}

export function findAssemblyJsonFileRow(fileRows = []) {
  return (
    fileRows.find(
      (f) => f.kind === "other" && isEnverAssemblyJsonName(f.original_name || f.originalName || "")
    ) || null
  );
}

/**
 * Еквівалент enver-b3d-assembly-export.js на сервері:
 * дописує ENVER3 у Bazis .b3d з enver-assembly.json, якщо хвоста ще немає.
 */
export async function buildPatchedB3dWithEnver3(b3dBuffer, assemblyExport) {
  if (!b3dBuffer?.length || !assemblyExport?.panels?.length) {
    return null;
  }
  if (extractEnverAssemblyFromB3d(b3dBuffer)) {
    return { buffer: b3dBuffer, alreadyPresent: true, panelCount: assemblyExport.panels.length };
  }
  return {
    buffer: appendEnverAssemblyToB3d(b3dBuffer, assemblyExport),
    alreadyPresent: false,
    panelCount: assemblyExport.panels.length
  };
}

export async function loadAssemblyExportFromJsonBuffer(jsonBuffer) {
  if (!jsonBuffer?.length) return null;
  try {
    return parseAssemblyExportJson(jsonBuffer.toString("utf8"));
  } catch {
    return null;
  }
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

/**
 * @param {Object} params
 * @param {Array} params.fileRows — рядки constructive_package_files (DB shape)
 * @returns {Promise<{ applied: boolean, panelCount?: number, reason?: string }>}
 */
export async function autoSyncEnver3ToPackageB3d({ fileRows = [] } = {}) {
  const b3dRow = fileRows.find((f) => f.kind === "b3d");
  if (!b3dRow?.storage_path) {
    return { applied: false, reason: "no_b3d" };
  }

  let b3dBuffer = await readStoredFile(b3dRow.storage_path);
  if (extractEnverAssemblyFromB3d(b3dBuffer)) {
    return { applied: false, reason: "already_has_enver3" };
  }

  const assemblyRow = findAssemblyJsonFileRow(fileRows);
  if (!assemblyRow?.storage_path) {
    return { applied: false, reason: "no_assembly_json" };
  }

  const assemblyExport = await loadAssemblyExportFromJsonBuffer(
    await readStoredFile(assemblyRow.storage_path)
  );
  if (!assemblyExport?.panels?.length) {
    return { applied: false, reason: "empty_assembly_json" };
  }

  const patched = await buildPatchedB3dWithEnver3(b3dBuffer, assemblyExport);
  if (!patched || patched.alreadyPresent) {
    return { applied: false, reason: "already_has_enver3", panelCount: patched?.panelCount };
  }

  await overwritePackageFileBuffer(b3dRow, patched.buffer);
  return {
    applied: true,
    panelCount: patched.panelCount,
    reason: "enver3_appended_from_json"
  };
}

/**
 * Для вкладки 3D замовлення: підтягує enver-assembly.json з пакета конструктива.
 */
export async function autoSyncEnver3ToOrderB3d(b3dStoragePath, { assemblyJsonBuffer } = {}) {
  if (!b3dStoragePath) return { applied: false, reason: "no_path" };

  let b3dBuffer = await readStoredFile(b3dStoragePath);
  if (extractEnverAssemblyFromB3d(b3dBuffer)) {
    return { applied: false, reason: "already_has_enver3" };
  }

  const assemblyExport = await loadAssemblyExportFromJsonBuffer(assemblyJsonBuffer);
  if (!assemblyExport?.panels?.length) {
    return { applied: false, reason: "no_assembly_json" };
  }

  const patched = await buildPatchedB3dWithEnver3(b3dBuffer, assemblyExport);
  if (!patched || patched.alreadyPresent) {
    return { applied: false, reason: "already_has_enver3" };
  }

  const full = resolveStoredPath(b3dStoragePath);
  await fs.writeFile(full, patched.buffer);
  return {
    applied: true,
    panelCount: patched.panelCount,
    reason: "enver3_appended_from_package_json"
  };
}
