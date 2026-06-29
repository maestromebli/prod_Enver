import fs from "fs";
import { all, one, run } from "../db.js";
import { resolveStoredPath } from "../file-storage.js";
import { decodeProjectText } from "./parsers/project-text.js";
import { parseProjectBuffer } from "./parsers/project-parser.js";
import {
  bazisScanLookupVariants,
  extractBazisOperationCodesFromProjectText,
  groupBazisOperationCodesByPartNo,
  isBazisOperationScanCode,
  normalizeBazisScanCode,
  partNoFromBazisOperationCode
} from "../../../shared/production/bazis-operation-code.js";
import { normalizePartNoKey } from "../../../shared/production/constructive-package.js";
import { buildBarcodeValue, buildPartCode } from "./part-code.js";

export async function readProjectTextsForPackage(packageId) {
  const files = await all(
    `SELECT storage_path, original_name FROM constructive_package_files
     WHERE package_id = $1 AND kind = 'project'`,
    [packageId]
  );
  const texts = [];
  for (const f of files) {
    const fullPath = resolveStoredPath(f.storage_path);
    if (!fs.existsSync(fullPath)) continue;
    try {
      texts.push(decodeProjectText(fs.readFileSync(fullPath)));
    } catch {
      /* ignore */
    }
  }
  return texts;
}

function projectTextContainsBazisCode(text, variants) {
  const hay = String(text || "").toLowerCase();
  for (const v of variants) {
    const needle = String(v).toLowerCase();
    if (!needle) continue;
    if (hay.includes(`code="${needle}"`)) return true;
    if (hay.includes(`code='${needle}'`)) return true;
    if (hay.includes(needle)) return true;
  }
  return false;
}

/** Пакети, у .project яких є цей код операції Bazis. */
export async function findPackageIdsByProjectBazisCode(scanCode) {
  const variants = bazisScanLookupVariants(scanCode);
  if (!variants.length) return [];

  const normalized = normalizeBazisScanCode(scanCode);
  const partNo = partNoFromBazisOperationCode(normalized);
  const found = new Set();

  if (partNo) {
    const fromParts = await all(
      `SELECT DISTINCT package_id
       FROM constructive_parts
       WHERE part_no = $1 OR part_no = $2 OR ltrim(part_no, '0') = $1`,
      [partNo, partNo.padStart(2, "0")]
    );
    for (const row of fromParts) found.add(row.package_id);
  }

  const files = await all(
    `SELECT package_id, storage_path FROM constructive_package_files
     WHERE kind = 'project'
     ORDER BY id DESC`
  );

  for (const f of files) {
    if (found.has(f.package_id)) continue;
    const fullPath = resolveStoredPath(f.storage_path);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const text = decodeProjectText(fs.readFileSync(fullPath));
      if (projectTextContainsBazisCode(text, variants)) {
        found.add(f.package_id);
      }
    } catch {
      /* ignore */
    }
  }

  return [...found];
}

/** Знайти деталь у пакеті за partNo з коду Bazis (без колонки bazis_operation_codes). */
async function findPartRowByPartNoInPackage(packageId, scanCode) {
  const partNo = partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode));
  if (!partNo) return null;

  return one(
    `SELECT * FROM constructive_parts
     WHERE package_id = $1
       AND (
         part_no = $2
         OR part_no = $3
         OR ltrim(part_no, '0') = $2
       )
     ORDER BY id
     LIMIT 1`,
    [packageId, partNo, partNo.padStart(2, "0")]
  );
}

async function findPartRowInPackageByBazis(packageId, scanCode) {
  const variants = bazisScanLookupVariants(scanCode).map((v) => v.toUpperCase());
  if (!variants.length) return null;

  return one(
    `SELECT * FROM constructive_parts
     WHERE package_id = $1
       AND (
         EXISTS (
           SELECT 1 FROM unnest(bazis_operation_codes) c
           WHERE upper(c) = ANY($2::text[])
         )
         OR part_no = $3
         OR part_no = $4
       )
     ORDER BY
       CASE WHEN EXISTS (
         SELECT 1 FROM unnest(bazis_operation_codes) c
         WHERE upper(c) = ANY($2::text[])
       ) THEN 0 ELSE 1 END
     LIMIT 1`,
    [
      packageId,
      variants,
      partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode)),
      partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode))?.padStart(2, "0") || ""
    ]
  );
}

async function ensurePartRowForBazis(packageId, partNo, opCodes) {
  const pkg = await one(
    `SELECT id, position_id, order_id FROM constructive_packages WHERE id = $1`,
    [packageId]
  );
  if (!pkg) return null;

  const position = await one(`SELECT order_number FROM positions WHERE id = $1`, [pkg.position_id]);
  const orderNumber = position?.order_number || "ORD";

  let row = await one(
    `SELECT * FROM constructive_parts
     WHERE package_id = $1 AND (part_no = $2 OR ltrim(part_no, '0') = $2)`,
    [packageId, partNo]
  );

  if (!row) {
    const files = await all(
      `SELECT storage_path, original_name FROM constructive_package_files
       WHERE package_id = $1 AND kind = 'project' LIMIT 1`,
      [packageId]
    );
    const file = files[0];
    if (!file) return null;

    const fullPath = resolveStoredPath(file.storage_path);
    if (!fs.existsSync(fullPath)) return null;

    const parsed = parseProjectBuffer(fs.readFileSync(fullPath), file.original_name);
    const parsedPart = (parsed.parts || []).find(
      (p) => normalizePartNoKey(p.partNo) === normalizePartNoKey(partNo)
    );
    if (!parsedPart) return null;

    const partCode = buildPartCode({
      orderNumber,
      blockCode: parsedPart.blockCode,
      partNo: parsedPart.partNo
    });
    const barcode = buildBarcodeValue({
      orderNumber,
      positionId: pkg.position_id,
      packageId,
      partNo: parsedPart.partNo || partNo,
      blockCode: parsedPart.blockCode || ""
    });

    const insert = await one(
      `INSERT INTO constructive_parts
       (package_id, order_id, position_id, block_code, part_no, part_code, part_name,
        material, thickness, qty, length, width, edge_code, note, barcode_value, qr_value,
        bazis_operation_codes, model_mesh_name, model_node_id, cnc_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'waiting')
       RETURNING *`,
      [
        packageId,
        pkg.order_id,
        pkg.position_id,
        parsedPart.blockCode || "",
        String(parsedPart.partNo || partNo),
        partCode,
        parsedPart.partName || "",
        parsedPart.material || "",
        parsedPart.thickness || "",
        Number(parsedPart.qty) || 1,
        String(parsedPart.length || ""),
        String(parsedPart.width || ""),
        parsedPart.edgeCode || "",
        parsedPart.note || "",
        barcode,
        barcode,
        opCodes,
        String(parsedPart.partNo || partNo),
        String(parsedPart.partNo || partNo)
      ]
    );
    row = insert;
  }

  return row;
}

/** Зберігає коди операцій Bazis у constructive_parts / instances. */
export async function syncBazisOperationCodesForPackage(packageId) {
  const texts = await readProjectTextsForPackage(packageId);
  if (!texts.length) return { updated: 0 };

  const codes = [...new Set(texts.flatMap((t) => extractBazisOperationCodesFromProjectText(t)))];
  const byPartNo = groupBazisOperationCodesByPartNo(codes);
  if (!byPartNo.size) return { updated: 0 };

  const parts = await all(
    `SELECT id, part_no, qty, bazis_operation_codes, model_mesh_name, model_node_id
     FROM constructive_parts WHERE package_id = $1`,
    [packageId]
  );

  let updated = 0;
  const partByNo = new Map();
  for (const part of parts) {
    partByNo.set(normalizePartNoKey(part.part_no), part);
    partByNo.set(String(part.part_no || "").trim(), part);
  }

  for (const [mapKey, opCodes] of byPartNo.entries()) {
    const part =
      partByNo.get(mapKey) ||
      partByNo.get(normalizePartNoKey(mapKey)) ||
      partByNo.get(String(Number(mapKey)));
    if (!part) continue;

    const partNo = String(part.part_no || mapKey).trim();
    const existing = Array.isArray(part.bazis_operation_codes) ? part.bazis_operation_codes : [];
    const merged = [...new Set([...existing, ...opCodes])];
    const changed = merged.length !== existing.length || merged.some((c, i) => c !== existing[i]);
    const needsMesh = !part.model_mesh_name && !part.model_node_id && partNo;

    if (!changed && !needsMesh) continue;

    await run(
      `UPDATE constructive_parts
       SET bazis_operation_codes = $1,
           model_mesh_name = CASE WHEN model_mesh_name = '' AND $3 <> '' THEN $3 ELSE model_mesh_name END,
           model_node_id = CASE WHEN model_node_id = '' AND $3 <> '' THEN $3 ELSE model_node_id END,
           updated_at = now()
       WHERE id = $2`,
      [merged, part.id, partNo]
    );
    updated += 1;

    const instances = await all(
      `SELECT id, instance_no, bazis_operation_code FROM constructive_part_instances
       WHERE part_id = $1 ORDER BY instance_no`,
      [part.id]
    );
    for (let i = 0; i < instances.length; i += 1) {
      const code = opCodes[i] || opCodes[0] || "";
      if (!code || instances[i].bazis_operation_code === code) continue;
      await run(`UPDATE constructive_part_instances SET bazis_operation_code = $1 WHERE id = $2`, [
        code,
        instances[i].id
      ]);
    }
  }

  return { updated };
}

export async function resyncBazisOperationCodesForAllPackages() {
  const rows = await all(
    `SELECT DISTINCT cp.id AS package_id
     FROM constructive_packages cp
     INNER JOIN constructive_package_files f ON f.package_id = cp.id AND f.kind = 'project'
     ORDER BY cp.id`
  );
  let updated = 0;
  for (const row of rows) {
    try {
      const r = await syncBazisOperationCodesForPackage(row.package_id);
      updated += r.updated || 0;
    } catch {
      /* ignore */
    }
  }
  return { packages: rows.length, partsUpdated: updated };
}

/** Резолв деталі за кодом Bazis через .project (lazy backfill). */
export async function resolvePartRowByBazisProjectScan(scanCode) {
  if (!isBazisOperationScanCode(scanCode)) return null;

  const normalized = normalizeBazisScanCode(scanCode);
  const partNo = partNoFromBazisOperationCode(normalized);
  if (!partNo) return null;

  const packageIds = await findPackageIdsByProjectBazisCode(scanCode);
  for (const packageId of packageIds) {
    try {
      await syncBazisOperationCodesForPackage(packageId);
    } catch {
      /* bazis_operation_codes може ще не існувати до міграції 0026 */
    }

    let row = null;
    try {
      row = await findPartRowInPackageByBazis(packageId, scanCode);
    } catch {
      row = await findPartRowByPartNoInPackage(packageId, scanCode);
    }
    if (row) return row;

    const texts = await readProjectTextsForPackage(packageId);
    const codes = [...new Set(texts.flatMap((t) => extractBazisOperationCodesFromProjectText(t)))];
    const opCodes = groupBazisOperationCodesByPartNo(codes).get(partNo) || [];

    try {
      row = await ensurePartRowForBazis(packageId, partNo, opCodes);
      if (row) {
        try {
          await syncBazisOperationCodesForPackage(packageId);
        } catch {
          /* ignore */
        }
        try {
          row = (await findPartRowInPackageByBazis(packageId, scanCode)) || row;
        } catch {
          /* ignore */
        }
        return row;
      }
    } catch {
      row = await findPartRowByPartNoInPackage(packageId, scanCode);
      if (row) return row;
    }
  }

  return null;
}
