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
  PACKAGE_FILE_KIND_LABELS
} from "../../../shared/production/constructive-package.js";
import { isMultiInstancePackageFileKind } from "../../../shared/production/cnc-file-meta.js";
import {
  buildBarcodeValue,
  buildInstanceBarcode,
  buildPartCode,
  computeChecksum
} from "./part-code.js";
import { mergeParseResults, parsePackageFiles } from "./parsers/index.js";
import { extractPackagePreviewGlb } from "./b3d-glb-extractor.js";
import { autoSyncEnver3ToPackageB3d, isEnverAssemblyJsonName } from "./b3d-auto-enver3.js";
import { readPreviewLayoutFromGlb } from "./project-glb-builder.js";
import { isLegacySharedMeshPreviewGlb } from "./project-glb-builder.js";
import { recordHistory } from "../audit.js";
import { tryAutoCreateProcurementFromPackage } from "./procurement-service.js";

const AUTO_PREVIEW_GLB_NAME = "3d-preview.glb";

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
  const pkg = await getPackageById(packageId);
  if (!pkg) return null;
  let files = await getPackageFiles(packageId);

  const legacyPreview = files.find((f) => f.original_name === AUTO_PREVIEW_GLB_NAME);
  if (legacyPreview?.storage_path && files.some((f) => f.kind === "b3d" || f.kind === "project")) {
    try {
      const buf = await readStoredFile(legacyPreview.storage_path);
      if (isLegacySharedMeshPreviewGlb(buf)) {
        await withTransaction(async (client) => {
          await ensureB3dPreviewGlb(packageId, pkg.position_id, files, client);
        });
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
  return {
    package: pkg,
    files,
    parts,
    materials,
    hardware,
    manifest: manifest
      ? { id: manifest.id, manifestJson: JSON.parse(manifest.manifest_json || "{}") }
      : null,
    procurement: procurement
      ? {
          id: procurement.id,
          status: procurement.status,
          totalEstimated: procurement.total_estimated
        }
      : null,
    unmappedParts: parts.filter((p) => !p.modelNodeId && !p.modelMeshName)
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

/** GLB для перегляду: витягується з GibLab .b3d після завантаження. */
async function ensureB3dPreviewGlb(packageId, positionId, fileRows, client) {
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
      await client.query(`DELETE FROM constructive_package_files WHERE id = $1`, [old.id]);
    }
  }

  const assemblyFile = fileRows.find(
    (f) =>
      f.kind === "other" &&
      (f.original_name === "enver-assembly.json" ||
        f.original_name?.toLowerCase().endsWith(".enver-assembly.json"))
  );
  let [b3dBuf, projectBuf, assemblyBuf] = await Promise.all([
    b3dFile ? readStoredFile(b3dFile.storage_path) : Promise.resolve(null),
    projectFile ? readStoredFile(projectFile.storage_path) : Promise.resolve(null),
    assemblyFile ? readStoredFile(assemblyFile.storage_path) : Promise.resolve(null)
  ]);

  await autoSyncEnver3ToPackageB3d({ fileRows });
  if (b3dFile) {
    b3dBuf = await readStoredFile(b3dFile.storage_path);
  }

  let preview;
  try {
    preview = extractPackagePreviewGlb({
      b3dBuffer: b3dBuf,
      projectBuffer: projectBuf,
      assemblyJsonBuffer: assemblyBuf,
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
  const insert = await client.query(
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
  }
  return row || null;
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

  if (savedFiles.some((f) => f.kind === "b3d" || f.kind === "project")) {
    const fileRows = await getPackageFiles(packageId);
    await autoSyncEnver3ToPackageB3d({ fileRows });
    await withTransaction(async (client) => {
      await ensureB3dPreviewGlb(packageId, positionId, fileRows, client);
    });
  } else if (
    savedFiles.some((f) => f.kind === "other" && isEnverAssemblyJsonName(f.originalName))
  ) {
    const fileRows = await getPackageFiles(packageId);
    const synced = await autoSyncEnver3ToPackageB3d({ fileRows });
    if (synced.applied) {
      await withTransaction(async (client) => {
        await ensureB3dPreviewGlb(packageId, positionId, fileRows, client);
      });
    }
  }

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
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  await run(
    `UPDATE constructive_packages SET status = 'parsing', updated_at = now() WHERE id = $1`,
    [packageId]
  );

  try {
    const fileRows = await all(`SELECT * FROM constructive_package_files WHERE package_id = $1`, [
      packageId
    ]);
    const parseResults = await parsePackageFiles(fileRows, readStoredFile);

    const merged = mergeParseResults(parseResults);
    const position = await one(`SELECT * FROM positions WHERE id = $1`, [pkg.position_id]);

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

      const previewGlbRow = await ensureB3dPreviewGlb(packageId, pkg.position_id, fileRows, client);
      const glbFile =
        previewGlbRow ||
        fileRows.find((f) => f.kind === "wrl_model") ||
        fileRows.find((f) => f.kind === "glb_model" || f.kind === "gltf_model");
      const b3dFile = fileRows.find((f) => f.kind === "b3d");
      const modelSourceFile = glbFile || b3dFile;
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
          : null
      });
      const existingManifest = await client.query(
        `SELECT id FROM model_manifests WHERE package_id = $1 LIMIT 1`,
        [packageId]
      );
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

export async function findPartByBarcode(barcodeValue) {
  const code = String(barcodeValue || "").trim();
  if (!code) return null;

  let row = await one(`SELECT * FROM constructive_parts WHERE barcode_value = $1`, [code]);
  if (!row) {
    row = await one(`SELECT * FROM constructive_parts WHERE qr_value = $1`, [code]);
  }
  if (!row) {
    const inst = await one(`SELECT * FROM constructive_part_instances WHERE barcode_value = $1`, [
      code
    ]);
    if (inst) {
      row = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [inst.part_id]);
    }
  }
  return row ? mapPartRow(row) : null;
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
            blockCode &&
            n.meshName.toLowerCase().includes(blockCode.toLowerCase()) &&
            n.meshName.includes(partNo)
        )) ||
      nodes.find((n) => n.meshName && partNo && n.meshName.includes(partNo)) ||
      nodes.find((n) => n.partNo && partNo && String(n.partNo) === partNo) ||
      nodes.find(
        (n) => n.meshName && blockCode && n.meshName.toLowerCase().includes(blockCode.toLowerCase())
      );
    if (match) {
      mapped.push({
        partId: part.id,
        modelNodeId: match.nodeId || match.meshName,
        modelMeshName: match.meshName || ""
      });
    }
  }
  return mapped;
}
