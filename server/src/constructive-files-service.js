import fs from "fs";
import { all, one, run } from "./db.js";
import {
  CONSTRUCTIVE_MAX_BYTES,
  isConstructiveExtension
} from "../../shared/production/constructive-files.js";
import { resolveStoredPath } from "./file-storage.js";

export { CONSTRUCTIVE_MAX_BYTES, isConstructiveExtension };

export const CONSTRUCTIVE_FILE_NAME_SUBQUERY = `(SELECT pf.original_name FROM position_files pf
  WHERE pf.position_id = p.id AND pf.kind = 'constructive'
  ORDER BY pf.created_at DESC LIMIT 1) AS constructive_file_name`;

export const CONSTRUCTIVE_FILE_COUNT_SUBQUERY = `(SELECT COUNT(*)::int FROM position_files pf
  WHERE pf.position_id = p.id AND pf.kind = 'constructive') AS constructive_file_count`;

export function mapConstructiveFileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.original_name,
    mime: row.mime || "application/octet-stream",
    sizeBytes: Number(row.size_bytes) || 0,
    createdAt: row.created_at ?? null
  };
}

export async function listConstructiveFiles(positionId) {
  const rows = await all(
    `SELECT id, original_name, mime, size_bytes, created_at
     FROM position_files
     WHERE position_id = $1 AND kind = 'constructive'
     ORDER BY created_at ASC, id ASC`,
    [positionId]
  );
  return rows.map(mapConstructiveFileRow);
}

export async function getConstructiveFileForDownload(positionId, fileId = null) {
  const row = fileId
    ? await one(
        `SELECT * FROM position_files
         WHERE id = $1 AND position_id = $2 AND kind = 'constructive'`,
        [fileId, positionId]
      )
    : await one(
        `SELECT * FROM position_files
         WHERE position_id = $1 AND kind = 'constructive'
         ORDER BY created_at DESC LIMIT 1`,
        [positionId]
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

export function setConstructiveDownloadHeaders(res, fileRow) {
  res.setHeader("Content-Type", fileRow.mime || "application/octet-stream");
  const name = String(fileRow.original_name || "file");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
  );
}

export function pipeConstructiveFile(res, fullPath, fileRow) {
  setConstructiveDownloadHeaders(res, fileRow);
  return fs.createReadStream(fullPath).pipe(res);
}

export async function deleteConstructiveFile(positionId, fileId) {
  const row = await one(
    `SELECT * FROM position_files WHERE id = $1 AND position_id = $2 AND kind = 'constructive'`,
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

  const remaining = await all(
    `SELECT id FROM position_files WHERE position_id = $1 AND kind = 'constructive'`,
    [positionId]
  );

  return { deleted: true, hasFilesLeft: remaining.length > 0 };
}
