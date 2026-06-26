import { one } from "../../db.js";
import { logStageChangeWithAutoHandoffs } from "../../audit.js";
import { auditActor, requirePositionAccess, requirePositionWrite } from "../../middleware/auth.js";
import { applyStageHandoff, detectAutoHandoffs } from "../../position-logic.js";
import { saveConstructiveFile } from "../../file-storage.js";
import {
  CONSTRUCTIVE_MAX_BYTES,
  deleteConstructiveFile,
  getConstructiveFileForDownload,
  isConstructiveExtension,
  listConstructiveFiles,
  pipeConstructiveFile
} from "../../constructive-files-service.js";

function maxSizeLabelMb() {
  return Math.round(CONSTRUCTIVE_MAX_BYTES / (1024 * 1024));
}

async function streamConstructiveDownload(res, positionId, fileId = null) {
  const payload = await getConstructiveFileForDownload(positionId, fileId);
  if (!payload) {
    res.status(404).json({ error: "Файл не знайдено" });
    return;
  }
  pipeConstructiveFile(res, payload.fullPath, payload.row);
}

/** Реєструє маршрути завантаження / скачування конструктиву. */
export function registerConstructiveRoutes(
  router,
  { loadRow, saveRow, planDateByOrderNumber, mapEnrichedRow }
) {
  router.get("/:id/constructive-files", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await loadRow(id);
    if (!existing) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }
    res.json(await listConstructiveFiles(id));
  });

  router.get("/:id/constructive-file/:fileId", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    if (!fileId) {
      res.status(400).json({ error: "Некоректний ідентифікатор файлу" });
      return;
    }
    try {
      await streamConstructiveDownload(res, id, fileId);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Помилка завантаження файлу" });
    }
  });

  router.get("/:id/constructive-file", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    try {
      await streamConstructiveDownload(res, id);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Помилка завантаження файлу" });
    }
  });

  router.post("/:id/constructive-file", requirePositionWrite, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await loadRow(id);
    if (!existing) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }

    const { fileName, mime, dataBase64 } = req.body || {};
    if (!fileName || !dataBase64) {
      res.status(400).json({ error: "fileName та dataBase64 обов'язкові" });
      return;
    }
    if (!isConstructiveExtension(fileName)) {
      res.status(400).json({ error: "Непідтримуваний тип файлу" });
      return;
    }

    let buffer;
    try {
      buffer = Buffer.from(String(dataBase64), "base64");
    } catch {
      res.status(400).json({ error: "Некоректні дані файлу" });
      return;
    }
    if (buffer.length > CONSTRUCTIVE_MAX_BYTES) {
      res.status(400).json({ error: `Файл завеликий (макс. ${maxSizeLabelMb()} МБ)` });
      return;
    }

    const saved = await saveConstructiveFile(id, {
      buffer,
      originalName: fileName,
      mime: mime || "application/octet-stream"
    });

    const fileRow = await one(
      `INSERT INTO position_files (position_id, kind, original_name, storage_path, mime, size_bytes, uploaded_by)
       VALUES ($1, 'constructive', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        id,
        saved.originalName,
        saved.storagePath,
        saved.mime,
        saved.size,
        auditActor(req)?.id || null
      ]
    );

    const before = { ...existing };
    existing.has_constructive_file = true;
    const handedOff = applyStageHandoff(existing, "constructor", { status: "Передано" });
    const planMap = await planDateByOrderNumber();
    const planDate = planMap.get(existing.order_number);
    await saveRow(id, handedOff, planDate);
    const afterRow = await loadRow(id);
    const autoHandoffs = detectAutoHandoffs(before, afterRow, "constructor");
    await logStageChangeWithAutoHandoffs(
      before,
      afterRow,
      "constructor",
      { status: "Передано" },
      auditActor(req),
      autoHandoffs
    );

    const files = await listConstructiveFiles(id);

    res.status(201).json({
      fileId: fileRow.id,
      fileName: saved.originalName,
      files,
      position: mapEnrichedRow(afterRow, planMap)
    });
  });

  router.delete("/:id/constructive-file/:fileId", requirePositionWrite, async (req, res) => {
    const id = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    const existing = await loadRow(id);
    if (!existing) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }
    try {
      const result = await deleteConstructiveFile(id, fileId);
      const files = await listConstructiveFiles(id);
      if (!result.hasFilesLeft) {
        existing.has_constructive_file = false;
        const planMap = await planDateByOrderNumber();
        const planDate = planMap.get(existing.order_number);
        await saveRow(id, existing, planDate);
      }
      res.json({ ...result, files });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });
}
