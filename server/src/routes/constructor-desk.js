import { Router } from "express";
import fs from "fs";
import { requireAuth } from "../middleware/auth.js";
import {
  addDeskComment,
  assignConstructorDesk,
  getDeskFileForDownload,
  getDeskPosition,
  listConstructorUsers,
  listDeskOrders,
  listDeskPositions,
  saveDeskWorkspace,
  suggestTimingForPosition,
  uploadDeskFile,
  userCanWorkDesk
} from "../constructor-desk-store.js";

const router = Router();
router.use(requireAuth);

function requireDeskAccess(req, res, next) {
  if (userCanWorkDesk(req.user)) {
    next();
    return;
  }
  res.status(403).json({ error: "Немає доступу до столу конструктора" });
}

router.use(requireDeskAccess);

router.get("/orders", async (req, res) => {
  const onlyMine = req.query.mine === "1";
  res.json(await listDeskOrders(req.user, { onlyMine }));
});

router.get("/positions", async (req, res) => {
  const onlyMine = req.query.mine === "1";
  res.json(await listDeskPositions(req.user, { onlyMine }));
});

router.get("/constructors", async (_req, res) => {
  res.json(await listConstructorUsers());
});

router.get("/positions/:id", async (req, res) => {
  const data = await getDeskPosition(req.user, Number(req.params.id));
  if (!data) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  if (data.forbidden) {
    res.status(403).json({ error: "Недостатньо прав" });
    return;
  }
  res.json(data);
});

router.put("/positions/:id/assign", async (req, res) => {
  try {
    const data = await assignConstructorDesk(req.user, Number(req.params.id), req.body || {});
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put("/positions/:id/workspace", async (req, res) => {
  try {
    const data = await saveDeskWorkspace(req.user, Number(req.params.id), req.body || {});
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

router.post("/positions/:id/comments", async (req, res) => {
  try {
    const data = await addDeskComment(req.user, Number(req.params.id), req.body || {});
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/positions/:id/files", async (req, res) => {
  try {
    const file = await uploadDeskFile(req.user, Number(req.params.id), req.body || {});
    res.status(201).json(file);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/positions/:id/files/:fileId", async (req, res) => {
  const positionId = Number(req.params.id);
  const fileId = req.params.fileId;
  const payload = await getDeskFileForDownload(positionId, fileId);
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

router.post("/positions/:id/suggest-timing", async (req, res) => {
  try {
    const suggestion = await suggestTimingForPosition(req.user, Number(req.params.id));
    res.json(suggestion);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
