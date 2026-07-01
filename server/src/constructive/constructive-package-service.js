import fs from "fs";
import { all, one, run, withTransaction } from "../db.js";
import { readStoredFile, resolveStoredPath, savePackageFile } from "../file-storage.js";
import {
  CONSTRUCTIVE_MAX_BYTES,
  isConstructiveExtension
} from "../../../shared/production/constructive-files.js";
import {
  detectPackageFileKind,
  isPackageApprovedForCnc,
  canAutoParsePackage,
  canAppendFilesToPackage,
  canCreateModelMapping,
  findSplitMappingPackages,
  hasB3dMappingFile,
  hasProjectMappingFile,
  pickComplementMappingPackage,
  PACKAGE_FILE_KIND_LABELS,
  PACKAGE_PARSING_STALE_MS
} from "../../../shared/production/constructive-package.js";
import { isMultiInstancePackageFileKind } from "../../../shared/production/cnc-file-meta.js";
import {
  buildBarcodeValue,
  buildInstanceBarcode,
  buildPartCode,
  computeChecksum
} from "./part-code.js";
import { mergeParseResults, parsePackageFiles } from "./parsers/index.js";
import { getLatestPackageAiAnalysis, kickoffPackageAiAnalysis } from "./constructive-package-ai.js";
import { extractPackagePreviewGlb } from "./b3d-glb-extractor.js";
import { autoSyncEnver3ToPackageB3d, isEnverAssemblyJsonName } from "./b3d-auto-enver3.js";
import { autoSyncEnver3dscanToPackageB3d, findEnver3dscanJsonFileRow } from "./b3d-auto-3dscan.js";
import { fuseBazisPackage } from "./enver-3dscan-fusion.js";
import {
  syncBazisOperationCodesForPackage,
  resolvePartRowByBazisProjectScan,
  findPackageIdsByProjectBazisCode,
  findPartRowInPackageByBazis,
  findPartRowByPartNoInPackage
} from "./bazis-operation-sync.js";
import {
  bazisScanLookupVariants,
  isBazisOperationScanCode,
  normalizeBazisScanCode,
  partNoFromBazisOperationCode,
  pickBestPartRowForBazisScan
} from "../../../shared/production/bazis-operation-code.js";
import { readPreviewLayoutFromGlb } from "./project-glb-builder.js";
import { isLegacySharedMeshPreviewGlb } from "./project-glb-builder.js";
import { recordHistory } from "../audit.js";
import { tryAutoCreateProcurementFromPackage } from "./procurement-service.js";

const AUTO_PREVIEW_GLB_NAME = "3d-preview.glb";

/** Скидає завислий parsing → uploaded (після таймауту або падіння процесу). */
export async function recoverStaleParsingIfNeeded(packageId) {
  const row = await one(`SELECT id, status, updated_at FROM constructive_packages WHERE id = $1`, [
    packageId
  ]);
  if (!row || row.status !== "parsing") return false;
  const age = Date.now() - new Date(row.updated_at).getTime();
  if (Number.isFinite(age) && age < PACKAGE_PARSING_STALE_MS) return false;
  await run(
    `UPDATE constructive_packages SET status = 'uploaded', updated_at = now() WHERE id = $1 AND status = 'parsing'`,
    [packageId]
  );
  console.warn(`[constructive] скинуто завислий статус parsing для пакета #${packageId}`);
  return true;
}

export function mapPackageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    positionId: row.position_id,
    version: row.version,
    status: row.status,
    source: row.source,
    uploadedBy: row.uploaded_by,
    checkedBy: row.checked_by,
    approvedBy: row.approved_by,
    rejectedReason: row.rejected_reason || "",
    parsedAt: row.parsed_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapPackageFileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageId: row.package_id,
    kind: row.kind,
    kindLabel: PACKAGE_FILE_KIND_LABELS[row.kind] || row.kind,
    originalName: row.original_name,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes) || 0,
    materialType: row.material_type ?? "",
    materialDecor: row.material_decor ?? "",
    checksum: row.checksum,
    createdAt: row.created_at
  };
}

export function mapPartRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageId: row.package_id,
    orderId: row.order_id,
    positionId: row.position_id,
    blockCode: row.block_code,
    partNo: row.part_no,
    partCode: row.part_code,
    partName: row.part_name,
    material: row.material,
    thickness: row.thickness,
    qty: Number(row.qty) || 1,
    length: row.length,
    width: row.width,
    edgeCode: row.edge_code,
    note: row.note,
    barcodeValue: row.barcode_value,
    qrValue: row.qr_value,
    bazisOperationCodes: Array.isArray(row.bazis_operation_codes) ? row.bazis_operation_codes : [],
    cncStatus: row.cnc_status,
    modelNodeId: row.model_node_id,
    modelMeshName: row.model_mesh_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const PACKAGE_REPARSE_STATUSES = new Set([
  "parsed",
  "needs_review",
  "approved_by_constructor",
  "approved_by_production",
  "sent_to_procurement",
  "procurement_done",
  "cnc_ready",
  "sent_to_cnc",
  "released_to_cnc"
]);

async function nextPackageVersion(positionId) {
  const row = await one(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM constructive_packages WHERE position_id = $1`,
    [positionId]
  );
  return Number(row?.v) || 1;
}

export async function listPackagesForPosition(positionId) {
  const rows = await all(
    `SELECT * FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC`,
    [positionId]
  );
  return rows.map(mapPackageRow);
}

/** Склеїти .project і .b3d, якщо вони опинились у різних версіях пакета. */
export async function repairSplitMappingPackages(positionId) {
  const packages = await listPackagesForPosition(positionId);
  if (packages.length < 2) return null;

  const entries = await Promise.all(
    packages.map(async (pkg) => ({
      package: pkg,
      files: await getPackageFiles(pkg.id)
    }))
  );
  const plan = findSplitMappingPackages(entries);
  if (!plan) return null;

  const sourceFile = await one(`SELECT * FROM constructive_package_files WHERE id = $1`, [
    plan.fileId
  ]);
  if (!sourceFile) return null;

  const targetPkg = packages.find((p) => p.id === plan.targetPackageId);
  if (!targetPkg) return null;

  const targetFiles = await getPackageFiles(plan.targetPackageId);
  for (const old of targetFiles.filter((f) => f.kind === plan.missingKind)) {
    const row = await one(`SELECT * FROM constructive_package_files WHERE id = $1`, [old.id]);
    if (row) await removePackageFileRow(row);
  }

  await one(
    `INSERT INTO constructive_package_files
     (package_id, kind, original_name, mime, size_bytes, storage_path, checksum, material_type, material_decor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      plan.targetPackageId,
      sourceFile.kind,
      sourceFile.original_name,
      sourceFile.mime,
      sourceFile.size_bytes,
      sourceFile.storage_path,
      sourceFile.checksum,
      sourceFile.material_type || "",
      sourceFile.material_decor || ""
    ]
  );

  if (PACKAGE_REPARSE_STATUSES.has(targetPkg.status) || targetPkg.status === "parsed") {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM constructive_parts WHERE package_id = $1`, [
        plan.targetPackageId
      ]);
      await client.query(`DELETE FROM constructive_materials WHERE package_id = $1`, [
        plan.targetPackageId
      ]);
      await client.query(`DELETE FROM constructive_hardware WHERE package_id = $1`, [
        plan.targetPackageId
      ]);
      await client.query(
        `UPDATE constructive_packages SET status = 'uploaded', parsed_at = NULL, updated_at = now() WHERE id = $1`,
        [plan.targetPackageId]
      );
    });
  } else {
    await run(`UPDATE constructive_packages SET updated_at = now() WHERE id = $1`, [
      plan.targetPackageId
    ]);
  }

  return getPackageById(plan.targetPackageId);
}

async function resolveUploadTargetPackage(positionId, incomingKinds) {
  await repairSplitMappingPackages(positionId);

  const packages = await listPackagesForPosition(positionId);
  const entries = await Promise.all(
    packages.map(async (pkg) => {
      const files = await getPackageFiles(pkg.id);
      return { package: pkg, files, detail: { package: pkg, files } };
    })
  );

  const complementPkg = pickComplementMappingPackage(entries, incomingKinds);
  if (complementPkg) {
    return { packageId: complementPkg.id, pkgRow: complementPkg, isNew: false };
  }

  const latest = packages[0];
  if (latest && canAppendFilesToPackage(latest.status)) {
    return { packageId: latest.id, pkgRow: latest, isNew: false };
  }

  return { isNew: true };
}

export async function getLatestPackage(positionId) {
  await repairSplitMappingPackages(positionId);

  const packages = await listPackagesForPosition(positionId);
  if (!packages.length) return null;

  for (const pkg of packages) {
    const files = await getPackageFiles(pkg.id);
    if (hasProjectMappingFile(files) && hasB3dMappingFile(files)) {
      return pkg;
    }
  }

  return packages[0];
}

export async function getPackageById(packageId) {
  const row = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  return mapPackageRow(row);
}

export async function getPackageFiles(packageId) {
  const rows = await all(
    `SELECT * FROM constructive_package_files WHERE package_id = $1 ORDER BY created_at ASC`,
    [packageId]
  );
  return rows.map(mapPackageFileRow);
}

export async function getPackageParts(packageId) {
  const rows = await all(
    `SELECT * FROM constructive_parts WHERE package_id = $1 ORDER BY block_code, part_no, id`,
    [packageId]
  );
  return rows.map(mapPartRow);
}

export async function getPackageMaterials(packageId) {
  const rows = await all(`SELECT * FROM constructive_materials WHERE package_id = $1`, [packageId]);
  return rows.map((r) => ({
    id: r.id,
    materialName: r.material_name,
    materialCode: r.material_code,
    thickness: r.thickness,
    sheetSize: r.sheet_size,
    qtyEstimated: r.qty_estimated,
    unit: r.unit,
    source: r.source
  }));
}

export async function getPackageHardware(packageId) {
  const rows = await all(`SELECT * FROM constructive_hardware WHERE package_id = $1`, [packageId]);
  return rows.map((r) => ({
    id: r.id,
    blockCode: r.block_code,
    name: r.name,
    article: r.article,
    qty: r.qty,
    unit: r.unit,
    note: r.note
  }));
}

async function enrichPackageFilesPreviewLayout(fileRows = []) {
  return Promise.all(
    fileRows.map(async (row) => {
      if (row.original_name !== AUTO_PREVIEW_GLB_NAME || !row.storage_path) return row;
      try {
        const buf = await readStoredFile(row.storage_path);
        const layout = readPreviewLayoutFromGlb(buf);
        if (!layout) return row;
        return { ...row, preview_layout: layout, previewLayout: layout };
      } catch {
        return row;
      }
    })
  );
}

export async function getPackageDetail(packageId) {
  await recoverStaleParsingIfNeeded(packageId);
  const pkg = await getPackageById(packageId);
  if (!pkg) return null;
  let files = await getPackageFiles(packageId);

  const legacyPreview = files.find((f) => f.original_name === AUTO_PREVIEW_GLB_NAME);
  if (legacyPreview?.storage_path && files.some((f) => f.kind === "b3d" || f.kind === "project")) {
    try {
      const buf = await readStoredFile(legacyPreview.storage_path);
      if (isLegacySharedMeshPreviewGlb(buf)) {
        try {
          await ensureB3dPreviewGlb(packageId, pkg.position_id, files);
        } catch {
          /* ignore */
        }
        files = await getPackageFiles(packageId);
      }
    } catch {
      /* ignore — залишаємо наявний превʼю */
    }
  }

  files = await enrichPackageFilesPreviewLayout(files);

  const [parts, materials, hardware] = await Promise.all([
    getPackageParts(packageId),
    getPackageMaterials(packageId),
    getPackageHardware(packageId)
  ]);
  const manifest = await one(
    `SELECT * FROM model_manifests WHERE package_id = $1 ORDER BY id DESC LIMIT 1`,
    [packageId]
  );
  const procurement = await one(
    `SELECT * FROM procurement_requests WHERE package_id = $1 ORDER BY id DESC LIMIT 1`,
    [packageId]
  );
  const aiAnalysis = await getLatestPackageAiAnalysis(packageId);
  let manifestJson = null;
  if (manifest?.manifest_json) {
    try {
      manifestJson = JSON.parse(manifest.manifest_json || "{}");
    } catch {
      manifestJson = {};
    }
  }
  return {
    package: pkg,
    files,
    parts,
    materials,
    hardware,
    manifest: manifest ? { id: manifest.id, manifestJson: manifestJson || {} } : null,
    procurement: procurement
      ? {
          id: procurement.id,
          status: procurement.status,
          totalEstimated: procurement.total_estimated
        }
      : null,
    unmappedParts: parts.filter((p) => !p.modelNodeId && !p.modelMeshName),
    preview3d: manifestJson?.preview3d || null,
    aiAnalysis
  };
}

async function removePackageFileRow(row) {
  if (!row?.id) return;
  if (row.storage_path) {
    try {
      const full = resolveStoredPath(row.storage_path);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
  await run(`DELETE FROM constructive_package_files WHERE id = $1`, [row.id]);
}

/** Видалити файл з пакета; при зміні розібраного пакета — скинути до «uploaded». */
export async function deletePackageFile(packageId, fileId, actor) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }
  if (pkg.status === "parsing") {
    const err = new Error("Пакет зараз розбирається — зачекайте");
    err.status = 409;
    throw err;
  }

  const file = await one(
    `SELECT * FROM constructive_package_files WHERE id = $1 AND package_id = $2`,
    [fileId, packageId]
  );
  if (!file) {
    const err = new Error("Файл не знайдено");
    err.status = 404;
    throw err;
  }

  await removePackageFileRow(file);

  if (PACKAGE_REPARSE_STATUSES.has(pkg.status)) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM constructive_parts WHERE package_id = $1`, [packageId]);
      await client.query(`DELETE FROM constructive_materials WHERE package_id = $1`, [packageId]);
      await client.query(`DELETE FROM constructive_hardware WHERE package_id = $1`, [packageId]);
      await client.query(
        `UPDATE constructive_packages SET status = 'uploaded', updated_at = now() WHERE id = $1`,
        [packageId]
      );
    });
  } else {
    await run(`UPDATE constructive_packages SET updated_at = now() WHERE id = $1`, [packageId]);
  }

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    pkg.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: pkg.position_id,
    action: "update",
    meta: {
      summary: `Видалено файл пакета: ${file.original_name}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return getPackageDetail(packageId);
}

async function savePreview3dMeta(packageId, glbFileId, preview, enver3Sync = null) {
  const existing = await one(`SELECT manifest_json FROM model_manifests WHERE package_id = $1`, [
    packageId
  ]);
  let manifest = {};
  try {
    manifest = JSON.parse(existing?.manifest_json || "{}");
  } catch {
    manifest = {};
  }

  const missingCodes = preview?.missingCodes || [];
  const assembledCount =
    preview?.assembledCount ??
    (preview?.panelCount != null && missingCodes.length
      ? Math.max(0, preview.panelCount - missingCodes.length)
      : null);

  manifest.preview3d = {
    layout: preview?.layout || "flat",
    source: preview?.source || null,
    conversionStatus: preview?.conversionStatus || preview?.status || null,
    panelCount: preview?.panelCount ?? null,
    assembledCount,
    missingCodes,
    isPartialAssembly: Boolean(preview?.isPartialAssembly || missingCodes.length),
    exportedAt: preview?.exportedAt || null,
    productName: preview?.productName || null,
    enver3Sync: enver3Sync
      ? {
          applied: Boolean(enver3Sync.applied),
          reason: enver3Sync.reason || null,
          panelCount: enver3Sync.panelCount ?? null
        }
      : manifest.preview3d?.enver3Sync || null,
    updatedAt: new Date().toISOString()
  };

  await saveModelManifest(packageId, manifest, glbFileId);
}

/** GLB для перегляду: витягується з GibLab .b3d після завантаження. */
async function ensureB3dPreviewGlb(packageId, positionId, fileRows, { enver3Sync = null } = {}) {
  const hasUser3dPreview = fileRows.some(
    (f) =>
      f.kind === "wrl_model" ||
      ((f.kind === "glb_model" || f.kind === "gltf_model") &&
        f.original_name !== AUTO_PREVIEW_GLB_NAME)
  );
  if (hasUser3dPreview) {
    return (
      fileRows.find((f) => f.kind === "wrl_model") ||
      fileRows.find((f) => f.kind === "glb_model" || f.kind === "gltf_model") ||
      null
    );
  }

  const b3dFile = fileRows.find((f) => f.kind === "b3d");
  const projectFile = fileRows.find((f) => f.kind === "project");
  if (!b3dFile && !projectFile) return null;

  for (const old of fileRows.filter((f) => f.original_name === AUTO_PREVIEW_GLB_NAME)) {
    if (old?.id) {
      await run(`DELETE FROM constructive_package_files WHERE id = $1`, [old.id]);
    }
  }

  const assemblyFile = fileRows.find(
    (f) =>
      f.kind === "other" &&
      (f.original_name === "enver-assembly.json" ||
        f.original_name?.toLowerCase().endsWith(".enver-assembly.json"))
  );
  const scanFile = findEnver3dscanJsonFileRow(fileRows);
  let [b3dBuf, projectBuf, assemblyBuf, scanBuf] = await Promise.all([
    b3dFile ? readStoredFile(b3dFile.storage_path) : Promise.resolve(null),
    projectFile ? readStoredFile(projectFile.storage_path) : Promise.resolve(null),
    assemblyFile ? readStoredFile(assemblyFile.storage_path) : Promise.resolve(null),
    scanFile ? readStoredFile(scanFile.storage_path) : Promise.resolve(null)
  ]);

  await autoSyncEnver3ToPackageB3d({ fileRows });
  await autoSyncEnver3dscanToPackageB3d({ fileRows });
  if (b3dFile) {
    b3dBuf = await readStoredFile(b3dFile.storage_path);
  }

  let preview;
  try {
    preview = extractPackagePreviewGlb({
      b3dBuffer: b3dBuf,
      projectBuffer: projectBuf,
      assemblyJsonBuffer: assemblyBuf,
      scanJsonBuffer: scanBuf,
      productName:
        b3dFile?.original_name?.replace(/\.b3d$/i, "") ||
        projectFile?.original_name?.replace(/\.project$/i, "") ||
        ""
    });
  } catch {
    return null;
  }

  const saved = await savePackageFile(positionId, packageId, {
    buffer: preview.buffer,
    originalName: AUTO_PREVIEW_GLB_NAME,
    mime: "model/gltf-binary"
  });
  const checksum = computeChecksum(preview.buffer);
  const insert = await run(
    `INSERT INTO constructive_package_files
     (package_id, kind, original_name, mime, size_bytes, storage_path, checksum, material_type, material_decor)
     VALUES ($1, 'glb_model', $2, $3, $4, $5, $6, '', '')
     RETURNING *`,
    [packageId, saved.originalName, saved.mime, saved.size, saved.storagePath, checksum]
  );
  const row = insert.rows[0];
  if (row) {
    row.panelCount = preview.panelCount || null;
    row.previewSource = preview.source;
    row.previewLayout = preview.layout || "flat";
    await savePreview3dMeta(packageId, row.id, preview, enver3Sync);
  }
  return row || null;
}

async function runPostUploadB3dPipeline(packageId, positionId, savedFiles) {
  try {
    if (savedFiles.some((f) => f.kind === "b3d" || f.kind === "project")) {
      const fileRows = await getPackageFiles(packageId);
      const enver3Sync = await autoSyncEnver3ToPackageB3d({ fileRows });
      await ensureB3dPreviewGlb(packageId, positionId, fileRows, { enver3Sync });
    } else if (
      savedFiles.some((f) => f.kind === "other" && isEnverAssemblyJsonName(f.originalName))
    ) {
      const fileRows = await getPackageFiles(packageId);
      const enver3Sync = await autoSyncEnver3ToPackageB3d({ fileRows });
      if (enver3Sync.applied) {
        await ensureB3dPreviewGlb(packageId, positionId, fileRows, { enver3Sync });
      }
    }
  } catch (err) {
    console.warn("[constructive] post-upload b3d preview:", err?.message || err);
  }
}

async function saveFilesToPackage(packageId, positionId, files = []) {
  const savedFiles = [];
  for (const file of files) {
    if (!file.buffer || !file.originalName) continue;
    if (!isConstructiveExtension(file.originalName) && file.kind === "other") {
      const err = new Error(`Непідтримуваний тип файлу: ${file.originalName}`);
      err.status = 400;
      throw err;
    }
    if (file.buffer.length > CONSTRUCTIVE_MAX_BYTES) {
      const err = new Error(`Файл ${file.originalName} завеликий`);
      err.status = 400;
      throw err;
    }

    const kind = file.kind || detectPackageFileKind(file.originalName);
    if (!isMultiInstancePackageFileKind(kind)) {
      const oldRows = await all(
        `SELECT * FROM constructive_package_files WHERE package_id = $1 AND kind = $2`,
        [packageId, kind]
      );
      for (const old of oldRows) {
        await removePackageFileRow(old);
      }
    }

    const checksum = computeChecksum(file.buffer);
    const saved = await savePackageFile(positionId, packageId, {
      buffer: file.buffer,
      originalName: file.originalName,
      mime: file.mime
    });

    const fileRow = await one(
      `INSERT INTO constructive_package_files
       (package_id, kind, original_name, mime, size_bytes, storage_path, checksum, material_type, material_decor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        packageId,
        kind,
        saved.originalName,
        saved.mime,
        saved.size,
        saved.storagePath,
        checksum,
        String(file.materialType || "").trim(),
        String(file.materialDecor || "").trim()
      ]
    );
    savedFiles.push(mapPackageFileRow(fileRow));
  }
  return savedFiles;
}

/**
 * Завантажує файли в останній пакет (uploaded) або створює новий.
 * Якщо є файли конструктора + ЧПК — автоматично розбирає пакет і створює мапінг 3D.
 */
export async function uploadConstructivePackageFiles({
  positionId,
  positionRow,
  files,
  uploadedBy,
  actor
}) {
  if (!files.length) {
    const err = new Error("Додайте хоча б один файл пакета");
    err.status = 400;
    throw err;
  }

  const incomingKinds = files.map((f) => f.kind || detectPackageFileKind(f.originalName));
  const target = await resolveUploadTargetPackage(positionId, incomingKinds);
  let packageId;
  let pkgRow;
  let isNewPackage = false;

  if (!target.isNew) {
    packageId = target.packageId;
    pkgRow = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
    if (pkgRow.status !== "uploaded") {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM constructive_parts WHERE package_id = $1`, [packageId]);
        await client.query(`DELETE FROM constructive_materials WHERE package_id = $1`, [packageId]);
        await client.query(`DELETE FROM constructive_hardware WHERE package_id = $1`, [packageId]);
        await client.query(
          `UPDATE constructive_packages SET status = 'uploaded', parsed_at = NULL, updated_at = now() WHERE id = $1`,
          [packageId]
        );
      });
    }
    pkgRow = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  } else {
    isNewPackage = true;
    const version = await nextPackageVersion(positionId);
    pkgRow = await one(
      `INSERT INTO constructive_packages (order_id, position_id, version, status, uploaded_by)
       VALUES ($1, $2, $3, 'uploaded', $4)
       RETURNING *`,
      [positionRow.order_id, positionId, version, uploadedBy || null]
    );
    packageId = pkgRow.id;
  }

  const savedFiles = await saveFilesToPackage(packageId, positionId, files);
  if (!savedFiles.length) {
    const err = new Error("Не вдалося зберегти жодного файлу");
    err.status = 400;
    throw err;
  }

  await runPostUploadB3dPipeline(packageId, positionId, savedFiles);

  await run(`UPDATE constructive_packages SET updated_at = now() WHERE id = $1`, [packageId]);

  await run(`UPDATE positions SET has_constructive_file = TRUE WHERE id = $1`, [positionId]);

  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: isNewPackage
        ? `Завантажено пакет конструктива v${pkgRow.version} (${savedFiles.length} файлів)`
        : `Додано ${savedFiles.length} файл(ів) до пакета конструктива v${pkgRow.version}`,
      orderNumber: positionRow.order_number,
      item: positionRow.item
    },
    actor
  });

  let detail = await getPackageDetail(packageId);
  let autoParsed = false;
  let autoParseError = null;

  if (canAutoParsePackage(detail)) {
    try {
      detail = await parseConstructivePackage(packageId, actor);
      autoParsed = true;
      const summaryParts = [];
      if (canCreateModelMapping(detail)) summaryParts.push("мапінг 3D");
      if (detail?.procurement?.id || detail?.autoProcurement) summaryParts.push("закупівля з XLS");
      await recordHistory({
        entityType: "position",
        entityId: positionId,
        action: "update",
        meta: {
          summary: `Автоматично розібрано пакет v${pkgRow.version}${summaryParts.length ? ` (${summaryParts.join(", ")})` : ""}`,
          orderNumber: positionRow.order_number,
          item: positionRow.item
        },
        actor
      });
    } catch (err) {
      autoParseError = err.message || "Помилка автоматичного розбору";
      await run(
        `UPDATE constructive_packages SET status = 'uploaded', updated_at = now() WHERE id = $1 AND status = 'parsing'`,
        [packageId]
      );
      detail = await getPackageDetail(packageId);
    }
  }

  return { ...detail, autoParsed, autoParseError };
}

/** @deprecated Використовуйте uploadConstructivePackageFiles */
export async function createConstructivePackage({
  positionId,
  positionRow,
  files,
  uploadedBy,
  actor
}) {
  const result = await uploadConstructivePackageFiles({
    positionId,
    positionRow,
    files,
    uploadedBy,
    actor
  });
  return { package: result.package, files: result.files, autoParsed: result.autoParsed };
}

/** Розбір пакета → parts/materials/hardware. */
export async function parseConstructivePackage(packageId, actor) {
  await recoverStaleParsingIfNeeded(packageId);

  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  if (pkg.status === "parsing") {
    const err = new Error("Пакет уже розбирається — зачекайте кілька секунд");
    err.status = 409;
    throw err;
  }

  await run(
    `UPDATE constructive_packages SET status = 'parsing', updated_at = now() WHERE id = $1`,
    [packageId]
  );

  try {
    let fileRows = await all(`SELECT * FROM constructive_package_files WHERE package_id = $1`, [
      packageId
    ]);
    const parseResults = await parsePackageFiles(fileRows, readStoredFile);

    const merged = mergeParseResults(parseResults);
    const position = await one(`SELECT * FROM positions WHERE id = $1`, [pkg.position_id]);

    try {
      await autoSyncEnver3ToPackageB3d({ fileRows });
      await autoSyncEnver3dscanToPackageB3d({ fileRows });
      fileRows = await all(`SELECT * FROM constructive_package_files WHERE package_id = $1`, [
        packageId
      ]);
    } catch (syncErr) {
      console.warn(
        "[constructive] enver3/3dscan sync під час розбору:",
        syncErr?.message || syncErr
      );
    }

    const b3dRow = fileRows.find((f) => f.kind === "b3d");
    const projectRow = fileRows.find((f) => f.kind === "project");
    const scanRow = findEnver3dscanJsonFileRow(fileRows);
    if (b3dRow || projectRow) {
      try {
        const [b3dBuf, projectBuf, scanBuf] = await Promise.all([
          b3dRow ? readStoredFile(b3dRow.storage_path) : null,
          projectRow ? readStoredFile(projectRow.storage_path) : null,
          scanRow ? readStoredFile(scanRow.storage_path) : null
        ]);
        const fused = fuseBazisPackage({
          b3dBuffer: b3dBuf,
          projectBuffer: projectBuf,
          scanJsonBuffer: scanBuf
        });
        if (fused.parts?.length) {
          merged.parts = fused.parts;
        }
        if (fused.manifestNodes?.length) {
          merged.manifestNodes = [...(merged.manifestNodes || []), ...fused.manifestNodes];
        }
        merged.warnings = [...new Set([...(merged.warnings || []), ...(fused.warnings || [])])];
        merged.enver3dscan = fused.stats || null;
      } catch (fuseErr) {
        console.warn("[constructive] ENVER_3dscan fusion:", fuseErr?.message || fuseErr);
      }
    }

    let previewGlbRow = null;
    try {
      previewGlbRow = await ensureB3dPreviewGlb(packageId, pkg.position_id, fileRows);
      if (previewGlbRow) {
        fileRows = await all(`SELECT * FROM constructive_package_files WHERE package_id = $1`, [
          packageId
        ]);
      }
    } catch (previewErr) {
      console.warn("[constructive] 3D-превʼю під час розбору:", previewErr?.message || previewErr);
    }

    const glbFile =
      previewGlbRow ||
      fileRows.find((f) => f.kind === "wrl_model") ||
      fileRows.find((f) => f.kind === "glb_model" || f.kind === "gltf_model");
    const b3dFile = fileRows.find((f) => f.kind === "b3d");
    const modelSourceFile = glbFile || b3dFile;

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM constructive_parts WHERE package_id = $1`, [packageId]);
      await client.query(`DELETE FROM constructive_materials WHERE package_id = $1`, [packageId]);
      await client.query(`DELETE FROM constructive_hardware WHERE package_id = $1`, [packageId]);

      for (const m of merged.materials) {
        await client.query(
          `INSERT INTO constructive_materials
         (package_id, material_name, material_code, thickness, sheet_size, qty_estimated, unit, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            packageId,
            m.materialName || "",
            m.materialCode || "",
            m.thickness || "",
            m.sheetSize || "",
            String(m.qtyEstimated || ""),
            m.unit || "",
            m.source || "parser"
          ]
        );
      }

      for (const h of merged.hardware) {
        await client.query(
          `INSERT INTO constructive_hardware (package_id, block_code, name, article, qty, unit, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            packageId,
            h.blockCode || "",
            h.name || "",
            h.article || "",
            String(h.qty || ""),
            h.unit || "",
            h.note || ""
          ]
        );
      }

      const partNoCounts = new Map();
      for (const p of merged.parts) {
        const key = `${p.blockCode || ""}:${p.partNo || ""}`;
        partNoCounts.set(key, (partNoCounts.get(key) || 0) + 1);
      }

      const usedBarcodes = new Set();
      const insertedParts = [];
      for (const p of merged.parts) {
        const key = `${p.blockCode || ""}:${p.partNo || ""}`;
        const needsBlock = (partNoCounts.get(key) || 0) > 1 || !p.partNo;
        const partCode = buildPartCode({
          orderNumber: position.order_number,
          blockCode: p.blockCode,
          partNo: p.partNo
        });

        let barcode = buildBarcodeValue({
          orderNumber: position.order_number,
          positionId: pkg.position_id,
          packageId,
          partNo: p.partNo || "0",
          blockCode: needsBlock ? p.blockCode : ""
        });

        let suffix = 0;
        while (usedBarcodes.has(barcode)) {
          suffix += 1;
          barcode = buildBarcodeValue({
            orderNumber: position.order_number,
            positionId: pkg.position_id,
            packageId,
            partNo: p.partNo || "0",
            blockCode: p.blockCode || "",
            suffix: String(suffix)
          });
        }
        usedBarcodes.add(barcode);

        const partInsert = await client.query(
          `INSERT INTO constructive_parts
         (package_id, order_id, position_id, block_code, part_no, part_code, part_name,
          material, thickness, qty, length, width, edge_code, note, barcode_value, qr_value, cnc_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'waiting')
         RETURNING id`,
          [
            packageId,
            position.order_id,
            pkg.position_id,
            p.blockCode || "",
            String(p.partNo || ""),
            partCode,
            p.partName || "",
            p.material || "",
            p.thickness || "",
            Number(p.qty) || 1,
            String(p.length || ""),
            String(p.width || ""),
            p.edgeCode || "",
            p.note || "",
            barcode,
            barcode
          ]
        );

        const partId = partInsert.rows[0]?.id;
        if (partId) {
          insertedParts.push({
            id: partId,
            blockCode: p.blockCode || "",
            partNo: String(p.partNo || ""),
            partName: p.partName || ""
          });
        }
        const qty = Math.max(1, Number(p.qty) || 1);

        if (partId && qty > 1) {
          for (let i = 1; i <= qty; i += 1) {
            const instBarcode = i === 1 ? barcode : buildInstanceBarcode(barcode, i);
            await client.query(
              `INSERT INTO constructive_part_instances (part_id, instance_no, barcode_value, status)
             VALUES ($1,$2,$3,'active')`,
              [partId, i, instBarcode]
            );
          }
        }
      }

      const mappingSources = {
        project: fileRows.filter((f) => f.kind === "project").length,
        b3d: fileRows.filter((f) => f.kind === "b3d").length
      };
      const allowModelMapping = mappingSources.project > 0 && mappingSources.b3d > 0;

      const autoMapped = allowModelMapping
        ? autoMapManifestNodes(insertedParts, merged.manifestNodes || [])
        : [];
      for (const m of autoMapped) {
        await client.query(
          `UPDATE constructive_parts SET model_node_id = $1, model_mesh_name = $2, updated_at = now() WHERE id = $3`,
          [m.modelNodeId || "", m.modelMeshName || "", m.partId]
        );
      }

      const existingManifestRow = await client.query(
        `SELECT manifest_json FROM model_manifests WHERE package_id = $1 LIMIT 1`,
        [packageId]
      );
      let preservedPreview3d = null;
      if (existingManifestRow.rows[0]?.manifest_json) {
        try {
          preservedPreview3d =
            JSON.parse(existingManifestRow.rows[0].manifest_json)?.preview3d || null;
        } catch {
          preservedPreview3d = null;
        }
      }

      const manifestPayload = JSON.stringify({
        nodes: merged.manifestNodes || [],
        autoMapped: autoMapped.length > 0,
        autoMappedCount: autoMapped.length,
        mappingSources,
        allowModelMapping,
        previewGlb: previewGlbRow
          ? {
              fileId: previewGlbRow.id,
              panelCount: previewGlbRow.panelCount || null,
              auto: true
            }
          : null,
        ...(preservedPreview3d ? { preview3d: preservedPreview3d } : {})
      });
      const existingManifest = existingManifestRow;
      if (existingManifest.rows[0]?.id) {
        await client.query(
          `UPDATE model_manifests SET manifest_json = $1, glb_file_id = COALESCE($2, glb_file_id) WHERE package_id = $3`,
          [manifestPayload, modelSourceFile?.id || null, packageId]
        );
      } else if (modelSourceFile || autoMapped.length > 0 || allowModelMapping) {
        await client.query(
          `INSERT INTO model_manifests (package_id, source_file_id, glb_file_id, manifest_json)
         VALUES ($1, $2, $2, $3)`,
          [packageId, modelSourceFile?.id || null, manifestPayload]
        );
      }

      const newStatus = merged.extractionQuality === "poor" ? "needs_review" : "parsed";
      await client.query(
        `UPDATE constructive_packages SET status = $1, parsed_at = now(), updated_at = now() WHERE id = $2`,
        [newStatus, packageId]
      );
    });

    try {
      await syncBazisOperationCodesForPackage(packageId);
    } catch {
      /* bazis_operation_codes може ще не існувати до міграції 0026 */
    }

    await run(`UPDATE positions SET has_constructive_file = TRUE WHERE id = $1`, [pkg.position_id]);

    await recordHistory({
      entityType: "position",
      entityId: pkg.position_id,
      action: "update",
      meta: {
        summary: `Пакет конструктива v${pkg.version} розібрано (${merged.parts.length} деталей)`,
        orderNumber: position.order_number,
        item: position.item
      },
      actor
    });

    let detail = await getPackageDetail(packageId);
    let autoProcurement = false;
    let autoProcurementError = null;
    const procurementResult = await tryAutoCreateProcurementFromPackage(packageId, actor);
    if (procurementResult.created) {
      autoProcurement = true;
      detail = await getPackageDetail(packageId);
    } else if (procurementResult.error) {
      autoProcurementError = procurementResult.error;
    }

    await kickoffPackageAiAnalysis(packageId, {
      orderNumber: position.order_number,
      item: position.item,
      itemType: position.item_type
    });
    detail = await getPackageDetail(packageId);

    return { ...detail, autoProcurement, autoProcurementError };
  } catch (err) {
    await run(
      `UPDATE constructive_packages SET status = 'uploaded', updated_at = now() WHERE id = $1 AND status = 'parsing'`,
      [packageId]
    );
    throw err;
  }
}

export async function approvePackage(packageId, { role, userId, actor }) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  const status =
    role === "production" || role === "admin"
      ? "approved_by_production"
      : "approved_by_constructor";

  await run(
    `UPDATE constructive_packages
     SET status = $1, approved_by = $2, approved_at = now(), updated_at = now()
     WHERE id = $3`,
    [status, userId, packageId]
  );

  await run(`UPDATE positions SET has_constructive_file = TRUE WHERE id = $1`, [pkg.position_id]);

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    pkg.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: pkg.position_id,
    action: "update",
    meta: {
      summary: `Пакет конструктива v${pkg.version} підтверджено`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  if (status === "approved_by_production") {
    const { onPackageApprovedByProduction } = await import("../automation/package-handoff.js");
    const { notifyPackageApproved } = await import("../automation/dispatch.js");
    void notifyPackageApproved(pkg.position_id, {
      packageId,
      version: pkg.version
    }).catch((err) => console.error("[automation] package approved:", err?.message || err));
    void onPackageApprovedByProduction(
      { ...pkg, position_id: pkg.position_id, id: packageId },
      { actor }
    ).catch((err) => console.error("[automation] package approve:", err?.message || err));
  }

  return getPackageById(packageId);
}

export async function rejectPackage(packageId, reason, actor) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  await run(
    `UPDATE constructive_packages
     SET status = 'rejected', rejected_reason = $1, updated_at = now()
     WHERE id = $2`,
    [String(reason || "").trim(), packageId]
  );

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    pkg.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: pkg.position_id,
    action: "update",
    meta: {
      summary: `Пакет конструктива v${pkg.version} повернуто на доопрацювання: ${reason || "—"}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return getPackageById(packageId);
}

export async function releasePackageToCnc(packageId, _actor) {
  const pkg = await getPackageById(packageId);
  if (!isPackageApprovedForCnc(pkg?.status)) {
    const err = new Error("Пакет не пройшов перевірку — спочатку підтвердіть конструктив");
    err.status = 403;
    throw err;
  }

  await run(
    `UPDATE constructive_packages SET status = 'released_to_cnc', updated_at = now() WHERE id = $1`,
    [packageId]
  );

  const parts = await getPackageParts(packageId);
  for (const part of parts) {
    const existing = await one(`SELECT id FROM cnc_jobs WHERE part_id = $1`, [part.id]);
    if (!existing) {
      await run(
        `INSERT INTO cnc_jobs (order_id, position_id, package_id, part_id, stage, status)
         VALUES ($1,$2,$3,$4,'cutting','ready')`,
        [part.orderId, part.positionId, packageId, part.id]
      );
    }
    await run(`UPDATE constructive_parts SET cnc_status = 'ready' WHERE id = $1`, [part.id]);
  }

  return getPackageById(packageId);
}

export async function findPartByBarcode(barcodeValue, { positionId = null, orderId = null } = {}) {
  const code = String(barcodeValue || "").trim();
  if (!code) return null;

  const scopedPositionId = Number(positionId) > 0 ? Number(positionId) : null;
  let scopedOrderId = Number(orderId) > 0 ? Number(orderId) : null;

  let part = await findPartByBarcodeCascade(code, {
    positionId: scopedPositionId,
    orderId: scopedOrderId
  });
  if (part) return part;

  if (scopedPositionId && isBazisOperationScanCode(code)) {
    await resyncBazisForPositionScan(scopedPositionId, code);
    if (!scopedOrderId) {
      const pos = await one(`SELECT order_id FROM positions WHERE id = $1`, [scopedPositionId]);
      scopedOrderId = pos?.order_id ? Number(pos.order_id) : null;
    }
    part = await findPartByBarcodeCascade(code, {
      positionId: scopedPositionId,
      orderId: scopedOrderId
    });
  }

  return part;
}

async function resyncBazisForPositionScan(positionId, scanCode) {
  const packages = await all(
    `SELECT id FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC, id DESC`,
    [positionId]
  );
  for (const pkg of packages) {
    try {
      await syncBazisOperationCodesForPackage(pkg.id);
    } catch {
      /* bazis_operation_codes може бути недоступна */
    }
    try {
      await resolvePartRowByBazisProjectScan(scanCode, { positionId });
    } catch {
      /* ignore */
    }
  }
}

async function findPartByBarcodeCascade(code, { positionId = null, orderId = null } = {}) {
  const scopedPositionId = Number(positionId) > 0 ? Number(positionId) : null;
  let scopedOrderId = Number(orderId) > 0 ? Number(orderId) : null;

  if (scopedPositionId) {
    const part = await findPartByBarcodeInScope(code, { positionId: scopedPositionId });
    if (part) return part;
  }

  if (!scopedOrderId && scopedPositionId) {
    const pos = await one(`SELECT order_id FROM positions WHERE id = $1`, [scopedPositionId]);
    scopedOrderId = pos?.order_id ? Number(pos.order_id) : null;
  }

  if (scopedOrderId) {
    const part = await findPartByBarcodeInScope(code, { orderId: scopedOrderId });
    if (part) return part;
  }

  return findPartByBarcodeInScope(code, {});
}

async function findPartByBarcodeInScope(code, { positionId = null, orderId = null } = {}) {
  let row = await findPartRowByBarcodeOrQr(code, { positionId, orderId });
  if (row) return mapPartRow(row);

  if ((positionId || orderId) && isBazisOperationScanCode(code)) {
    row = await findPartRowByBazisInScope({ positionId, orderId }, code);
    if (row) return mapPartRow(row);
  }

  if (isBazisOperationScanCode(code)) {
    row = await findPartRowByBazisCodesInDb(code, { positionId, orderId });
    if (row) return mapPartRow(row);

    row = await resolvePartRowByBazisProjectScan(code, { positionId, orderId });
    if (row) return mapPartRow(row);

    row = await findPartRowByBazisPartNoGlobal(code, { positionId, orderId });
    if (row) return mapPartRow(row);

    row = await findPartRowByBazisNameHint(code, { positionId, orderId });
    if (row) return mapPartRow(row);
  } else {
    row = await findPartRowByBazisCodesInDb(code, { positionId, orderId });
    if (row) return mapPartRow(row);
  }

  return null;
}

async function findPartRowByBazisInScope({ positionId = null, orderId = null }, scanCode) {
  const packages = positionId
    ? await all(
        `SELECT id FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC, id DESC`,
        [positionId]
      )
    : orderId
      ? await all(
          `SELECT id FROM constructive_packages WHERE order_id = $1 ORDER BY version DESC, id DESC`,
          [orderId]
        )
      : [];
  for (const pkg of packages) {
    try {
      const row = await findPartRowInPackageByBazis(pkg.id, scanCode);
      if (row) return row;
    } catch {
      const row = await findPartRowByPartNoInPackage(pkg.id, scanCode);
      if (row) return row;
    }
  }

  const partNo = partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode));
  if (!partNo) return null;

  const padded = partNo.padStart(2, "0");
  const nameLike1 = `№${partNo} %`;
  const nameLike2 = `№${padded} %`;
  const nameRegex = `№\\s*0*${partNo}([^0-9]|$)`;

  const rows = positionId
    ? await all(
        `SELECT cp.* FROM constructive_parts cp
         WHERE (
           cp.position_id = $1
           OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $1)
         )
           AND (
             cp.part_no = $2 OR cp.part_no = $3 OR ltrim(cp.part_no, '0') = $2
             OR cp.part_name ILIKE $4 OR cp.part_name ILIKE $5
             OR cp.part_name ~ $6
           )
         ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
         LIMIT 20`,
        [positionId, partNo, padded, nameLike1, nameLike2, nameRegex]
      )
    : orderId
      ? await all(
          `SELECT * FROM constructive_parts
           WHERE order_id = $1
             AND (
               part_no = $2 OR part_no = $3 OR ltrim(part_no, '0') = $2
               OR part_name ILIKE $4 OR part_name ILIKE $5
               OR part_name ~ $6
             )
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT 20`,
          [orderId, partNo, padded, nameLike1, nameLike2, nameRegex]
        )
      : [];
  return pickBestPartRowForBazisScan(rows, scanCode);
}

/** Резерв: деталь знайдена за «№14 …» у назві, коли part_no у БД порожній або некоректний. */
async function findPartRowByBazisNameHint(scanCode, { positionId = null, orderId = null } = {}) {
  const partNo = partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode));
  if (!partNo) return null;

  const padded = partNo.padStart(2, "0");
  const nameLike1 = `№${partNo} %`;
  const nameLike2 = `№${padded} %`;
  const nameRegex = `№\\s*0*${partNo}([^0-9]|$)`;

  const rows = positionId
    ? await all(
        `SELECT cp.* FROM constructive_parts cp
         WHERE (
           cp.position_id = $1
           OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $1)
         )
           AND (cp.part_name ILIKE $2 OR cp.part_name ILIKE $3 OR cp.part_name ~ $4)
         ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
         LIMIT 12`,
        [positionId, nameLike1, nameLike2, nameRegex]
      )
    : orderId
      ? await all(
          `SELECT * FROM constructive_parts
           WHERE order_id = $1
             AND (part_name ILIKE $2 OR part_name ILIKE $3 OR part_name ~ $4)
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT 12`,
          [orderId, nameLike1, nameLike2, nameRegex]
        )
      : await all(
          `SELECT * FROM constructive_parts
           WHERE part_name ILIKE $1 OR part_name ILIKE $2 OR part_name ~ $3
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT 40`,
          [nameLike1, nameLike2, nameRegex]
        );

  return pickBestPartRowForBazisScan(rows, scanCode);
}

async function findPartRowByBarcodeOrQr(code, { positionId = null, orderId = null } = {}) {
  const variants = bazisScanLookupVariants(code);
  for (const v of variants) {
    let row = null;
    if (positionId) {
      row = await one(
        `SELECT cp.* FROM constructive_parts cp
         WHERE cp.barcode_value = $1
           AND (
             cp.position_id = $2
             OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $2)
           )`,
        [v, positionId]
      );
    } else if (orderId) {
      row = await one(
        `SELECT * FROM constructive_parts WHERE barcode_value = $1 AND order_id = $2`,
        [v, orderId]
      );
    } else {
      row = await one(`SELECT * FROM constructive_parts WHERE barcode_value = $1`, [v]);
    }
    if (row) return row;

    if (positionId) {
      row = await one(
        `SELECT cp.* FROM constructive_parts cp
         WHERE cp.qr_value = $1
           AND (
             cp.position_id = $2
             OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $2)
           )`,
        [v, positionId]
      );
    } else if (orderId) {
      row = await one(`SELECT * FROM constructive_parts WHERE qr_value = $1 AND order_id = $2`, [
        v,
        orderId
      ]);
    } else {
      row = await one(`SELECT * FROM constructive_parts WHERE qr_value = $1`, [v]);
    }
    if (row) return row;
  }
  return null;
}

async function findPartRowByBazisCodesInDb(code, { positionId = null, orderId = null } = {}) {
  const variants = bazisScanLookupVariants(code);
  const upperVariants = [...new Set(variants.map((v) => v.toUpperCase()))];
  if (!upperVariants.length) return null;

  try {
    let rows = [];
    try {
      rows = positionId
        ? await all(
            `SELECT cp.* FROM constructive_parts cp
             WHERE (
               cp.position_id = $2
               OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $2)
             )
               AND EXISTS (
                 SELECT 1 FROM unnest(cp.bazis_operation_codes) c
                 WHERE upper(c) = ANY($1::text[])
               )
             ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
             LIMIT 12`,
            [upperVariants, positionId]
          )
        : orderId
          ? await all(
              `SELECT * FROM constructive_parts
               WHERE order_id = $2
                 AND EXISTS (
                   SELECT 1 FROM unnest(bazis_operation_codes) c
                   WHERE upper(c) = ANY($1::text[])
                 )
               ORDER BY updated_at DESC NULLS LAST, id DESC
               LIMIT 12`,
              [upperVariants, orderId]
            )
          : await all(
              `SELECT * FROM constructive_parts
               WHERE EXISTS (
                 SELECT 1 FROM unnest(bazis_operation_codes) c
                 WHERE upper(c) = ANY($1::text[])
               )
               ORDER BY updated_at DESC NULLS LAST, id DESC
               LIMIT 12`,
              [upperVariants]
            );
    } catch {
      rows = [];
    }
    const matched = pickBestPartRowForBazisScan(rows, code);
    if (matched) return matched;

    for (const v of upperVariants) {
      const inst = positionId
        ? await one(
            `SELECT i.part_id FROM constructive_part_instances i
             JOIN constructive_parts cp ON cp.id = i.part_id
             WHERE (
               cp.position_id = $2
               OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $2)
             )
               AND (upper(i.barcode_value) = $1 OR upper(i.bazis_operation_code) = $1)
             LIMIT 1`,
            [v, positionId]
          )
        : orderId
          ? await one(
              `SELECT i.part_id FROM constructive_part_instances i
               JOIN constructive_parts cp ON cp.id = i.part_id
               WHERE cp.order_id = $2
                 AND (upper(i.barcode_value) = $1 OR upper(i.bazis_operation_code) = $1)
               LIMIT 1`,
              [v, orderId]
            )
          : await one(
              `SELECT part_id FROM constructive_part_instances
               WHERE upper(barcode_value) = $1 OR upper(bazis_operation_code) = $1
               LIMIT 1`,
              [v]
            );
      if (inst?.part_id) {
        const partRow = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [inst.part_id]);
        if (partRow) return partRow;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/** Останній резерв: partNo з коду Bazis по всіх пакетах (коли .project недоступний на диску). */
async function findPartRowByBazisPartNoGlobal(
  scanCode,
  { positionId = null, orderId = null } = {}
) {
  const partNo = partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode));
  if (!partNo) return null;

  let packageIds = await findPackageIdsByProjectBazisCode(scanCode);
  if (positionId) {
    const scoped = await all(`SELECT id FROM constructive_packages WHERE position_id = $1`, [
      positionId
    ]);
    const allowed = new Set(scoped.map((r) => r.id));
    packageIds = packageIds.filter((id) => allowed.has(id));
    if (!packageIds.length) packageIds = [...allowed];
  } else if (orderId) {
    const scoped = await all(`SELECT id FROM constructive_packages WHERE order_id = $1`, [orderId]);
    const allowed = new Set(scoped.map((r) => r.id));
    packageIds = packageIds.filter((id) => allowed.has(id));
    if (!packageIds.length) packageIds = [...allowed];
  }

  const rows = positionId
    ? await all(
        `SELECT cp.* FROM constructive_parts cp
         WHERE (
           cp.position_id = $1
           OR cp.package_id IN (SELECT id FROM constructive_packages WHERE position_id = $1)
         )
           AND (
             cp.part_no = $2 OR cp.part_no = $3 OR ltrim(cp.part_no, '0') = $2
             OR cp.part_name ILIKE $4 OR cp.part_name ILIKE $5
             OR cp.part_name ~ $6
           )
         ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
         LIMIT 40`,
        [
          positionId,
          partNo,
          partNo.padStart(2, "0"),
          `№${partNo} %`,
          `№${partNo.padStart(2, "0")} %`,
          `№\\s*0*${partNo}([^0-9]|$)`
        ]
      )
    : orderId
      ? await all(
          `SELECT * FROM constructive_parts
           WHERE order_id = $1
             AND (
               part_no = $2 OR part_no = $3 OR ltrim(part_no, '0') = $2
               OR part_name ILIKE $4 OR part_name ILIKE $5
               OR part_name ~ $6
             )
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT 40`,
          [
            orderId,
            partNo,
            partNo.padStart(2, "0"),
            `№${partNo} %`,
            `№${partNo.padStart(2, "0")} %`,
            `№\\s*0*${partNo}([^0-9]|$)`
          ]
        )
      : await all(
          `SELECT * FROM constructive_parts
           WHERE (
             part_no = $1 OR part_no = $2 OR ltrim(part_no, '0') = $1
             OR part_name ILIKE $3 OR part_name ILIKE $4
             OR part_name ~ $5
           )
           ORDER BY updated_at DESC NULLS LAST, id DESC
           LIMIT 80`,
          [
            partNo,
            partNo.padStart(2, "0"),
            `№${partNo} %`,
            `№${partNo.padStart(2, "0")} %`,
            `№\\s*0*${partNo}([^0-9]|$)`
          ]
        );
  if (!rows.length) return null;

  let candidates = rows;
  if (packageIds.length) {
    const scoped = rows.filter((r) => packageIds.includes(r.package_id));
    if (scoped.length) candidates = scoped;
  }

  return pickBestPartRowForBazisScan(candidates, scanCode);
}

export async function recordScanEvent({
  partId,
  barcodeValue,
  scannedBy,
  station,
  action,
  meta = {}
}) {
  await run(
    `INSERT INTO part_scan_events (part_id, barcode_value, scanned_by, station, action, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [partId, barcodeValue, scannedBy || null, station || "", action, JSON.stringify(meta)]
  );
}

export async function getPackageFileForDownload(packageId, fileId) {
  const row = await one(
    `SELECT * FROM constructive_package_files WHERE id = $1 AND package_id = $2`,
    [fileId, packageId]
  );
  if (!row) return null;
  const fullPath = resolveStoredPath(row.storage_path);
  if (!fs.existsSync(fullPath)) {
    const err = new Error("Файл відсутній на диску");
    err.status = 404;
    throw err;
  }
  return { row, fullPath };
}

export async function updatePartModelMapping(partId, { modelNodeId, modelMeshName }) {
  await run(
    `UPDATE constructive_parts SET model_node_id = $1, model_mesh_name = $2, updated_at = now() WHERE id = $3`,
    [modelNodeId || "", modelMeshName || "", partId]
  );
  return one(`SELECT * FROM constructive_parts WHERE id = $1`, [partId]).then(mapPartRow);
}

export async function saveModelManifest(packageId, manifestJson, glbFileId = null) {
  const existing = await one(`SELECT id FROM model_manifests WHERE package_id = $1`, [packageId]);
  if (existing) {
    await run(
      `UPDATE model_manifests SET manifest_json = $1, glb_file_id = COALESCE($2, glb_file_id) WHERE package_id = $3`,
      [JSON.stringify(manifestJson), glbFileId, packageId]
    );
  } else {
    await run(
      `INSERT INTO model_manifests (package_id, glb_file_id, manifest_json) VALUES ($1,$2,$3)`,
      [packageId, glbFileId, JSON.stringify(manifestJson)]
    );
  }
}

/** Автоматичне зіставлення mesh за іменем/номером (джерело — ЧПК, GLB не потрібен). */
export function autoMapManifestNodes(parts, nodes = []) {
  const mapped = [];
  for (const part of parts) {
    const partNo = String(part.partNo || "").trim();
    const blockCode = String(part.blockCode || "").trim();
    const compositeKey = blockCode && partNo ? `${blockCode}-${partNo}` : partNo ? partNo : "";

    const match =
      (compositeKey &&
        nodes.find(
          (n) =>
            String(n.meshName || "").toLowerCase() === compositeKey.toLowerCase() ||
            String(n.nodeId || "").toLowerCase() === compositeKey.toLowerCase()
        )) ||
      (blockCode &&
        partNo &&
        nodes.find(
          (n) =>
            String(n.blockCode || "").toLowerCase() === blockCode.toLowerCase() &&
            String(n.partNo || "") === partNo
        )) ||
      (partNo &&
        nodes.find(
          (n) =>
            n.meshName &&
            (String(n.meshName).toLowerCase() === `panel-${partNo}`.toLowerCase() ||
              String(n.meshName).toLowerCase() === partNo.toLowerCase() ||
              String(n.meshName).toLowerCase() === compositeKey.toLowerCase())
        )) ||
      nodes.find((n) => n.partNo && partNo && String(n.partNo) === partNo);
    if (match) {
      const meshName = match.meshName || (partNo ? `panel-${partNo}` : "") || match.nodeId || "";
      mapped.push({
        partId: part.id,
        modelNodeId: match.nodeId || meshName,
        modelMeshName: meshName
      });
    }
  }
  return mapped;
}
