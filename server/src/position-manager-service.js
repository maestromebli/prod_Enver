import fs from "fs";
import { all, one, run } from "./db.js";
import { saveConstructiveFile, resolveStoredPath } from "./file-storage.js";
import {
  MANAGER_FILE_KINDS,
  MANAGER_FILE_KIND_LABELS,
  buildManagerDataFromRow,
  defaultManagerDataJson,
  isManagerDataComplete,
  isManagerFileKind,
  managerDataCompletionPercent,
  parseManagerDataJson
} from "../../shared/production/position-manager-data.js";
import { recordHistory } from "./audit.js";
import {
  formatWorkspaceFileId,
  parseManagerFileId,
  workspaceKindToManagerKind
} from "../../shared/production/manager-file-adapter.js";
import { WORKSPACE_FILE_KINDS, parseWorkspaceJson } from "./constructor-desk-service.js";

export const MANAGER_FILE_COUNT_SUBQUERY = `(
  (SELECT COUNT(*)::int FROM position_files pf
    WHERE pf.position_id = p.id AND pf.kind LIKE 'manager_%')
  + (SELECT COUNT(*)::int FROM constructor_workspace_files cwf
    WHERE cwf.position_id = p.id AND cwf.kind IN ('tech', 'measurements', 'manager_image', 'custom'))
) AS manager_files_count`;

const WORKSPACE_MANAGER_KINDS = ["tech", "measurements", "manager_image", "custom"];

const MAX_MANAGER_FILE_BYTES = 80 * 1024 * 1024;

function mapManagerFileRow(row) {
  return {
    id: row.id,
    positionId: row.position_id,
    kind: row.kind,
    kindLabel: MANAGER_FILE_KIND_LABELS[row.kind] || row.kind,
    fileName: row.original_name,
    mime: row.mime || "application/octet-stream",
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    source: "position_files",
    readOnly: false
  };
}

function mapWorkspaceManagerFileRow(row) {
  const kind = workspaceKindToManagerKind(row.kind);
  return {
    id: formatWorkspaceFileId(row.id),
    positionId: row.position_id,
    kind,
    kindLabel: MANAGER_FILE_KIND_LABELS[kind] || WORKSPACE_FILE_KINDS[row.kind] || row.kind,
    fileName: row.original_name || row.label || row.external_url || "файл",
    mime: row.mime || (row.external_url ? "text/uri-list" : "application/octet-stream"),
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    source: "workspace",
    legacyKind: row.kind,
    externalUrl: row.external_url || null,
    readOnly: true
  };
}

async function countUnifiedManagerFiles(positionId) {
  const row = await one(
    `SELECT (
      (SELECT COUNT(*)::int FROM position_files WHERE position_id = $1 AND kind LIKE 'manager_%')
      + (SELECT COUNT(*)::int FROM constructor_workspace_files
         WHERE position_id = $1 AND kind = ANY($2::text[]))
    ) AS cnt`,
    [positionId, WORKSPACE_MANAGER_KINDS]
  );
  return Number(row?.cnt) || 0;
}

export function mapManagerDataFields(row) {
  const managerData = buildManagerDataFromRow(row);
  const filesCount = Number(row.manager_files_count ?? row.managerFilesCount) || 0;
  return {
    managerData,
    managerFilesCount: filesCount,
    managerDataComplete: isManagerDataComplete(row, managerData, { managerFilesCount: filesCount }),
    managerDataPercent: managerDataCompletionPercent(row, managerData, {
      managerFilesCount: filesCount
    })
  };
}

export async function listManagerFiles(positionId) {
  const [pfRows, wsRows] = await Promise.all([
    all(
      `SELECT * FROM position_files
       WHERE position_id = $1 AND kind LIKE 'manager_%'
       ORDER BY created_at ASC, id ASC`,
      [positionId]
    ),
    all(
      `SELECT * FROM constructor_workspace_files
       WHERE position_id = $1 AND kind = ANY($2::text[])
       ORDER BY created_at ASC, id ASC`,
      [positionId, WORKSPACE_MANAGER_KINDS]
    )
  ]);
  const merged = [...wsRows.map(mapWorkspaceManagerFileRow), ...pfRows.map(mapManagerFileRow)];
  merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return merged;
}

export async function getManagerFileForDownload(positionId, fileIdRaw) {
  const parsed = parseManagerFileId(fileIdRaw);
  if (parsed.source === "workspace") {
    const row = await one(
      `SELECT * FROM constructor_workspace_files WHERE id = $1 AND position_id = $2`,
      [parsed.id, positionId]
    );
    if (!row) return null;
    if (row.external_url) {
      return { externalUrl: row.external_url, row };
    }
    if (!row.storage_path) return null;
    const fullPath = resolveStoredPath(row.storage_path);
    if (!fs.existsSync(fullPath)) {
      const err = new Error("Файл відсутній на диску");
      err.status = 404;
      throw err;
    }
    return { row, fullPath };
  }

  const fileId = parsed.source === "position_files" ? parsed.id : Number(fileIdRaw);
  const row = await one(
    `SELECT * FROM position_files
     WHERE id = $1 AND position_id = $2 AND kind LIKE 'manager_%'`,
    [fileId, positionId]
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

function managerPayloadToDb(body = {}, existingRow = {}) {
  const existing = buildManagerDataFromRow(existingRow);
  const delivery = { ...existing.delivery, ...(body.delivery || {}) };
  const deadlines = { ...existing.deadlines, ...(body.deadlines || {}) };
  const comments = { ...existing.comments, ...(body.comments || {}) };
  const appliances = Array.isArray(body.appliances) ? body.appliances : existing.appliances;
  const sourceLinks = Array.isArray(body.sourceLinks) ? body.sourceLinks : existing.sourceLinks;

  const json = {
    delivery: {
      ...delivery,
      address: delivery.address ?? "",
      contactName: delivery.contactName ?? "",
      contactPhone: delivery.contactPhone ?? "",
      notes: delivery.notes ?? ""
    },
    deadlines: {
      positionDeadline: deadlines.positionDeadline ?? "",
      measurementDate: deadlines.measurementDate ?? "",
      installPreferredDate: deadlines.installPreferredDate ?? ""
    },
    appliances,
    comments,
    sourceLinks
  };

  return {
    delivery_address: String(json.delivery.address ?? "").trim(),
    delivery_contact_name: String(json.delivery.contactName ?? "").trim(),
    delivery_contact_phone: String(json.delivery.contactPhone ?? "").trim(),
    position_deadline: String(json.deadlines.positionDeadline ?? "").trim(),
    measurement_date: String(json.deadlines.measurementDate ?? "").trim(),
    installation_preferred_date: String(json.deadlines.installPreferredDate ?? "").trim(),
    manager_data_json: JSON.stringify(json)
  };
}

export async function saveManagerData(positionId, body, actor, { markComplete = null } = {}) {
  const existing = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!existing) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }

  const db = managerPayloadToDb(body, existing);
  const mergedRow = { ...existing, ...db };
  const managerData = buildManagerDataFromRow(mergedRow);
  const filesCount = await countUnifiedManagerFiles(positionId);

  const shouldComplete =
    markComplete === true ||
    (markComplete !== false && isManagerDataComplete(mergedRow, managerData, { managerFilesCount: filesCount }));

  await run(
    `UPDATE positions SET
      delivery_address = $2,
      delivery_contact_name = $3,
      delivery_contact_phone = $4,
      position_deadline = $5,
      measurement_date = $6,
      installation_preferred_date = $7,
      manager_data_json = $8,
      manager_data_completed_at = CASE WHEN $9 THEN COALESCE(manager_data_completed_at, now()) ELSE manager_data_completed_at END,
      manager_data_completed_by = CASE WHEN $9 THEN COALESCE(manager_data_completed_by, $10) ELSE manager_data_completed_by END
     WHERE id = $1`,
    [
      positionId,
      db.delivery_address,
      db.delivery_contact_name,
      db.delivery_contact_phone,
      db.position_deadline,
      db.measurement_date,
      db.installation_preferred_date,
      db.manager_data_json,
      shouldComplete,
      actor?.id || null
    ]
  );

  const row = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: shouldComplete ? "Дані менеджера по позиції заповнено" : "Оновлено дані менеджера по позиції",
      orderNumber: row.order_number,
      item: row.item
    },
    actor
  });

  return {
    positionId,
    ...mapManagerDataFields({ ...row, manager_files_count: filesCount })
  };
}

export async function uploadManagerFile(positionId, { fileName, mime, dataBase64, kind = "manager_other", comment = "" }, actor) {
  const existing = await one(`SELECT id, order_number, item FROM positions WHERE id = $1`, [positionId]);
  if (!existing) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }

  const fileKind = isManagerFileKind(kind) ? kind : "manager_other";
  if (!fileName || !dataBase64) {
    const err = new Error("fileName та dataBase64 обов'язкові");
    err.status = 400;
    throw err;
  }

  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length > MAX_MANAGER_FILE_BYTES) {
    const err = new Error("Файл завеликий (макс. 80 МБ)");
    err.status = 400;
    throw err;
  }

  const saved = await saveConstructiveFile(positionId, {
    buffer,
    originalName: fileName,
    mime: mime || "application/octet-stream"
  });

  const row = await one(
    `INSERT INTO position_files (position_id, kind, original_name, storage_path, mime, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      positionId,
      fileKind,
      saved.originalName,
      saved.storagePath,
      saved.mime,
      saved.size,
      actor?.id || null
    ]
  );

  if (comment?.trim()) {
    const md = parseManagerDataJson(
      (await one(`SELECT manager_data_json FROM positions WHERE id = $1`, [positionId]))
        ?.manager_data_json
    );
    md.comments = md.comments || {};
    md.comments.manager = [md.comments.manager, comment.trim()].filter(Boolean).join("\n");
    await run(`UPDATE positions SET manager_data_json = $2 WHERE id = $1`, [
      positionId,
      JSON.stringify(md)
    ]);
  }

  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: `Завантажено файл менеджера: ${saved.originalName}`,
      orderNumber: existing.order_number,
      item: existing.item
    },
    actor
  });

  return mapManagerFileRow(row);
}

export async function deleteManagerFile(positionId, fileId, actor) {
  const row = await one(
    `SELECT * FROM position_files WHERE id = $1 AND position_id = $2 AND kind LIKE 'manager_%'`,
    [fileId, positionId]
  );
  if (!row) {
    const err = new Error("Файл не знайдено");
    err.status = 404;
    throw err;
  }

  await run(`DELETE FROM position_files WHERE id = $1`, [fileId]);
  try {
    const full = resolveStoredPath(row.storage_path);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    /* ignore */
  }

  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: { summary: `Видалено файл менеджера: ${row.original_name}` },
    actor
  });

  return { deleted: true };
}

export async function getPositionManagerBundle(positionId) {
  const row = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!row) return null;
  const files = await listManagerFiles(positionId);
  const filesCount = files.length;
  const managerData = buildManagerDataFromRow(row);
  const ws = parseWorkspaceJson(row.constructor_workspace_json, row);
  if (String(ws.techLink || "").trim()) {
    const url = ws.techLink.trim();
    const hasTech = (managerData.appliances || []).some((a) => String(a.url || "").trim() === url);
    if (!hasTech) {
      managerData.appliances = [
        ...(managerData.appliances || []),
        { title: "Техніка (стіл конструктора)", url, note: "" }
      ];
    }
  }
  return {
    ...mapManagerDataFields({ ...row, manager_files_count: filesCount }),
    managerData,
    files
  };
}

export { MANAGER_FILE_KINDS, defaultManagerDataJson };
