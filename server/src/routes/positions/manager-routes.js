import fs from "fs";
import { auditActor, requirePermission, requirePositionAccess } from "../../middleware/auth.js";
import {
  deleteManagerFile,
  getManagerFileForDownload,
  getPositionManagerBundle,
  listManagerFiles,
  saveManagerData,
  uploadManagerFile
} from "../../position-manager-service.js";

/** Реєструє маршрути даних менеджера по позиції. */
export function registerManagerRoutes(router) {
  router.get("/:id/manager-data", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const bundle = await getPositionManagerBundle(id);
    if (!bundle) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }
    res.json(bundle);
  });

  router.put(
    "/:id/manager-data",
    requirePermission("canEditPositionManagerData"),
    async (req, res) => {
      const id = Number(req.params.id);
      try {
        const result = await saveManagerData(id, req.body || {}, auditActor(req), {
          markComplete: req.body?.markComplete
        });
        res.json(result);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  router.get("/:id/files", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const kind = String(req.query.kind || "");
    let files = await listManagerFiles(id);
    if (kind.startsWith("manager_")) {
      files = files.filter((f) => f.kind === kind);
    }
    res.json(files);
  });

  router.post("/:id/files", requirePermission("canEditPositionManagerData"), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const file = await uploadManagerFile(id, req.body || {}, auditActor(req));
      res.status(201).json(file);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.delete(
    "/:id/files/:fileId",
    requirePermission("canEditPositionManagerData"),
    async (req, res) => {
      const id = Number(req.params.id);
      const fileId = req.params.fileId;
      if (String(fileId).startsWith("ws-")) {
        res
          .status(400)
          .json({ error: "Файли робочого столу конструктора видаляються у столи конструктора" });
        return;
      }
      try {
        res.json(await deleteManagerFile(id, Number(fileId), auditActor(req)));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  router.get("/:id/files/:fileId/download", requirePositionAccess, async (req, res) => {
    const id = Number(req.params.id);
    const fileId = req.params.fileId;
    const payload = await getManagerFileForDownload(id, fileId);
    if (!payload) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }
    if (payload.externalUrl) {
      res.redirect(payload.externalUrl);
      return;
    }
    res.setHeader("Content-Type", payload.row.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(payload.row.original_name || "file")}`
    );
    fs.createReadStream(payload.fullPath).pipe(res);
  });
}
