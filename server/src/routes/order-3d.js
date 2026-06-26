import { Router } from "express";
import { auditActor, requireAuth } from "../middleware/auth.js";
import {
  attachWebModelToAsset,
  createProject3DAsset,
  deleteProject3DAsset,
  getOrder3DAssetById,
  getProject3DAsset,
  retryProject3DConversion
} from "../features/order-3d/order-3d-service.js";
import { readStoredFile } from "../features/order-3d/order-3d-storage.js";
import {
  canViewOriginalB3D,
  canViewB3DReport,
  canViewWebModel,
  detectOrder3DFileType
} from "../../../shared/production/order-3d.js";

const router = Router({ mergeParams: true });
router.use(requireAuth);

function decodeUploadBody(body) {
  if (!body?.fileName || !body?.dataBase64) return null;
  return {
    originalName: body.fileName,
    mime: body.mime || "application/octet-stream",
    buffer: Buffer.from(String(body.dataBase64), "base64")
  };
}

async function loadAssetForOrder(orderId, assetId) {
  const asset = await getOrder3DAssetById(assetId);
  if (!asset || asset.order_id !== orderId) return null;
  return asset;
}

router.get("/", async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!canViewWebModel(req.user)) {
    res.status(403).json({ error: "Недостатньо прав" });
    return;
  }
  const asset = await getProject3DAsset(orderId, req.user);
  res.json({ asset });
});

router.post("/upload", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const file = decodeUploadBody(req.body);
  if (!file) {
    res.status(400).json({ error: "Потрібні fileName та dataBase64" });
    return;
  }
  try {
    const asset = await createProject3DAsset(orderId, file, req.user);
    res.status(201).json({ asset, actor: auditActor(req) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/retry", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const assetId = Number(req.body?.assetId);
  if (!assetId) {
    res.status(400).json({ error: "Потрібен assetId" });
    return;
  }
  try {
    const current = await loadAssetForOrder(orderId, assetId);
    if (!current) {
      res.status(404).json({ error: "3D-актив не знайдено" });
      return;
    }
    const asset = await retryProject3DConversion(assetId, req.user);
    res.json({ asset });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/:assetId/web-model", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const assetId = Number(req.params.assetId);
  const file = decodeUploadBody(req.body);
  if (!file) {
    res.status(400).json({ error: "Потрібні fileName та dataBase64" });
    return;
  }
  try {
    const asset = await attachWebModelToAsset(orderId, assetId, file, req.user);
    res.json({ asset });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete("/:assetId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const assetId = Number(req.params.assetId);
  try {
    const current = await loadAssetForOrder(orderId, assetId);
    if (!current) {
      res.status(404).json({ error: "3D-актив не знайдено" });
      return;
    }
    await deleteProject3DAsset(assetId, req.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

async function streamAssetFile(req, res, field, { requireB3d = false } = {}) {
  const orderId = Number(req.params.orderId);
  const assetId = Number(req.params.assetId);
  const asset = await loadAssetForOrder(orderId, assetId);
  if (!asset) {
    res.status(404).json({ error: "Файл не знайдено" });
    return;
  }

  if (requireB3d && !canViewOriginalB3D(req.user)) {
    res.status(403).json({ error: "Недостатньо прав для завантаження .b3d" });
    return;
  }
  if (!requireB3d && !canViewWebModel(req.user)) {
    res.status(403).json({ error: "Недостатньо прав" });
    return;
  }

  const storagePath = asset[field];
  if (!storagePath) {
    res.status(404).json({ error: "Файл не знайдено" });
    return;
  }

  const buf = await readStoredFile(storagePath);
  const name =
    field === "original_storage_path"
      ? asset.original_file_name
      : field === "web_model_storage_path"
        ? storagePath.split("/").pop() || "model.glb"
        : "preview.png";
  const ext = detectOrder3DFileType(name);
  const mime =
    ext === "glb"
      ? "model/gltf-binary"
      : ext === "gltf"
        ? "model/gltf+json"
        : ext === "wrl"
          ? "model/vrml"
          : ext === "png"
            ? "image/png"
            : ext === "jpg"
              ? "image/jpeg"
              : ext === "json"
                ? "application/json"
                : "application/octet-stream";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
  res.send(buf);
}

router.get("/:assetId/original", (req, res) =>
  streamAssetFile(req, res, "original_storage_path", { requireB3d: true })
);
router.get("/:assetId/web-model", (req, res) =>
  streamAssetFile(req, res, "web_model_storage_path")
);
router.get("/:assetId/preview", (req, res) => streamAssetFile(req, res, "preview_storage_path"));
router.get("/:assetId/report", async (req, res) => {
  if (!canViewB3DReport(req.user)) {
    res.status(403).json({ error: "Недостатньо прав для B3D report" });
    return;
  }
  await streamAssetFile(req, res, "report_storage_path");
});

export default router;
