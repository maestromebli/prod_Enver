import fs from "fs";
import { one } from "../../db.js";
import { logStageChangeWithAutoHandoffs } from "../../audit.js";
import { auditActor, requirePositionAccess, requirePositionWrite } from "../../middleware/auth.js";
import { applyStageHandoff, detectAutoHandoffs } from "../../position-logic.js";
import { saveConstructiveFile, resolveStoredPath } from "../../file-storage.js";

/** Реєструє маршрути завантаження / скачування конструктиву. */
export function registerConstructiveRoutes(
  router,
  { loadRow, saveRow, planDateByOrderNumber, mapEnrichedRow }
) {
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

    let buffer;
    try {
      buffer = Buffer.from(String(dataBase64), "base64");
    } catch {
      res.status(400).json({ error: "Некоректні дані файлу" });
      return;
    }
    if (buffer.length > 8 * 1024 * 1024) {
      res.status(400).json({ error: "Файл завеликий (макс. 8 МБ)" });
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

    res.status(201).json({
      fileId: fileRow.id,
      fileName: saved.originalName,
      position: mapEnrichedRow({ ...afterRow, constructive_file_name: saved.originalName }, planMap)
    });
  });

  router.get("/:id/constructive-file", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const file = await one(
      `SELECT * FROM position_files
       WHERE position_id = $1 AND kind = 'constructive'
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (!file) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }
    const fullPath = resolveStoredPath(file.storage_path);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: "Файл відсутній на диску" });
      return;
    }
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.original_name)}"`
    );
    fs.createReadStream(fullPath).pipe(res);
  });
}
