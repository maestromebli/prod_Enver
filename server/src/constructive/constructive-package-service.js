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
  PACKAGE_FILE_KIND_LABELS
} from "../../../shared/production/constructive-package.js";
import {
  buildBarcodeValue,
  buildInstanceBarcode,
  buildPartCode,
  computeChecksum
} from "./part-code.js";
import { mergeParseResults, parsePackageFile } from "./parsers/index.js";
import { recordHistory } from "../audit.js";

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

export async function getLatestPackage(positionId) {
  const row = await one(
    `SELECT * FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC LIMIT 1`,
    [positionId]
  );
  return mapPackageRow(row);
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

export async function getPackageDetail(packageId) {
  const pkg = await getPackageById(packageId);
  if (!pkg) return null;
  const [files, parts, materials, hardware] = await Promise.all([
    getPackageFiles(packageId),
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

/** Створити нову версію пакета з файлами. */
export async function createConstructivePackage({
  positionId,
  positionRow,
  files,
  uploadedBy,
  actor
}) {
  const version = await nextPackageVersion(positionId);

  const pkgRow = await one(
    `INSERT INTO constructive_packages (order_id, position_id, version, status, uploaded_by)
     VALUES ($1, $2, $3, 'uploaded', $4)
     RETURNING *`,
    [positionRow.order_id, positionId, version, uploadedBy || null]
  );
  const packageId = pkgRow.id;
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
    const checksum = computeChecksum(file.buffer);
    const saved = await savePackageFile(positionId, packageId, {
      buffer: file.buffer,
      originalName: file.originalName,
      mime: file.mime
    });

    const fileRow = await one(
      `INSERT INTO constructive_package_files
       (package_id, kind, original_name, mime, size_bytes, storage_path, checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [packageId, kind, saved.originalName, saved.mime, saved.size, saved.storagePath, checksum]
    );
    savedFiles.push(mapPackageFileRow(fileRow));
  }

  await run(`UPDATE constructive_packages SET updated_at = now() WHERE id = $1`, [packageId]);

  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: `Завантажено пакет конструктива v${version} (${savedFiles.length} файлів)`,
      orderNumber: positionRow.order_number,
      item: positionRow.item
    },
    actor
  });

  return { package: mapPackageRow(pkgRow), files: savedFiles };
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

  const fileRows = await all(`SELECT * FROM constructive_package_files WHERE package_id = $1`, [
    packageId
  ]);
  const parseResults = [];

  for (const f of fileRows) {
    const buffer = await readStoredFile(f.storage_path);
    const result = await parsePackageFile({
      buffer,
      mime: f.mime,
      originalName: f.original_name,
      kind: f.kind
    });
    parseResults.push(result);
  }

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

    const autoMapped = autoMapManifestNodes(insertedParts, merged.manifestNodes || []);
    for (const m of autoMapped) {
      await client.query(
        `UPDATE constructive_parts SET model_node_id = $1, model_mesh_name = $2, updated_at = now() WHERE id = $3`,
        [m.modelNodeId || "", m.modelMeshName || "", m.partId]
      );
    }

    const glbFile = fileRows.find((f) => f.kind === "glb_model" || f.kind === "gltf_model");
    const manifestPayload = JSON.stringify({
      nodes: merged.manifestNodes || [],
      autoMapped: autoMapped.length > 0,
      autoMappedCount: autoMapped.length
    });
    const existingManifest = await client.query(
      `SELECT id FROM model_manifests WHERE package_id = $1 LIMIT 1`,
      [packageId]
    );
    if (existingManifest.rows[0]?.id) {
      await client.query(
        `UPDATE model_manifests SET manifest_json = $1, glb_file_id = COALESCE($2, glb_file_id) WHERE package_id = $3`,
        [manifestPayload, glbFile?.id || null, packageId]
      );
    } else if (glbFile || autoMapped.length > 0) {
      await client.query(
        `INSERT INTO model_manifests (package_id, source_file_id, glb_file_id, manifest_json)
         VALUES ($1, $2, $2, $3)`,
        [packageId, glbFile?.id || null, glbFile?.id || null, manifestPayload]
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

  return getPackageDetail(packageId);
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

export async function releasePackageToCnc(packageId, actor) {
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

/** Автоматичне зіставлення mesh за іменем/номером. */
export function autoMapManifestNodes(parts, nodes = []) {
  const mapped = [];
  for (const part of parts) {
    const match =
      nodes.find((n) => n.meshName && part.partName && n.meshName.includes(part.partNo)) ||
      nodes.find((n) => n.partNo && String(n.partNo) === String(part.partNo)) ||
      nodes.find(
        (n) =>
          n.meshName &&
          part.blockCode &&
          n.meshName.toLowerCase().includes(part.blockCode.toLowerCase())
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
