import { Router } from "express";
import { one } from "../db.js";
import { auditActor, requireAuth, requireOperatorPanelView } from "../middleware/auth.js";
import {
  findPartByBarcode,
  getPackageDetail,
  getPackageById,
  recordScanEvent
} from "../constructive/constructive-package-service.js";
import { getCncJobsForPosition, updateCncJobStatus } from "../integrations/cnc-jobs.js";
import { renderQrSvg, renderBarcodeSvg } from "../constructive/barcode.js";
import {
  CNC_PROBLEM_REASONS,
  findPackagePreview3dFile,
  preview3dLoadFormat
} from "../../../shared/production/constructive-package.js";
import { detectOrder3DFileType } from "../../../shared/production/order-3d.js";
import { recordHistory } from "../audit.js";
import { config } from "../config.js";

const router = Router();
router.use(requireAuth);

async function findOrderWebModel(orderId) {
  if (!orderId) return null;
  const row = await one(
    `SELECT id, web_model_storage_path, original_file_type, status
     FROM order_3d_assets
     WHERE order_id = $1
       AND status IN ('READY', 'PARTIAL_READY')
       AND web_model_storage_path IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId]
  );
  if (!row) return null;
  const fileName =
    String(row.web_model_storage_path || "")
      .split("/")
      .pop() || "";
  const ext = detectOrder3DFileType(fileName);
  return {
    assetId: row.id,
    orderId,
    format: ext !== "unknown" ? ext : "glb",
    status: row.status
  };
}

async function buildScanResponse(part) {
  const position = await one(`SELECT * FROM positions WHERE id = $1`, [part.positionId]);
  const order = position?.order_id
    ? await one(`SELECT * FROM orders WHERE id = $1`, [position.order_id])
    : null;
  const pkg = await getPackageById(part.packageId);
  const detail = await getPackageDetail(part.packageId);
  const cncJobs = await getCncJobsForPosition(part.positionId);
  const cncJob = cncJobs.find((j) => j.partId === part.id) || null;

  const previewFile = findPackagePreview3dFile(detail);
  const pdfFile = detail?.files?.find((f) => f.kind === "assembly_pdf");
  const orderWeb = order?.id ? await findOrderWebModel(order.id) : null;

  const host = config.domain ? `https://${config.domain}` : "";
  let viewerUrl = null;
  let viewerFormat = null;
  let viewerSource = null;

  if (orderWeb) {
    viewerUrl = `${host}/api/orders/${order.id}/3d/${orderWeb.assetId}/web-model`;
    viewerFormat = orderWeb.format;
    viewerSource = "order_3d";
  } else if (previewFile) {
    viewerUrl = `${host}/api/positions/${part.positionId}/constructive-packages/${part.packageId}/files/${previewFile.id}`;
    viewerFormat = preview3dLoadFormat(previewFile);
    viewerSource = "constructive_package";
  }

  return {
    part,
    order: order
      ? { id: order.id, orderNumber: order.order_number, object: order.object }
      : { orderNumber: position?.order_number },
    position: position
      ? {
          id: position.id,
          item: position.item,
          orderNumber: position.order_number
        }
      : null,
    package: pkg,
    cncJob,
    model: {
      viewerUrl,
      viewerFormat: viewerFormat || (previewFile ? preview3dLoadFormat(previewFile) : null),
      viewerSource,
      glbFileId: previewFile?.id || null,
      order3dAssetId: orderWeb?.assetId || null,
      manifest: detail?.manifest?.manifestJson || null,
      parts: detail?.parts || [],
      mapped: Boolean(part.modelNodeId || part.modelMeshName || part.partCode || part.partNo),
      assemblyPdfUrl: pdfFile
        ? `${host}/api/positions/${part.positionId}/constructive-packages/${part.packageId}/files/${pdfFile.id}`
        : null
    },
    nextAction: part.cncStatus === "in_progress" ? "finish_cnc" : "start_cnc"
  };
}

router.get("/scan/:barcodeValue", requireOperatorPanelView, async (req, res) => {
  const barcodeValue = String(req.params.barcodeValue || "").trim();
  const part = await findPartByBarcode(barcodeValue);

  if (!part) {
    res.status(404).json({
      error: "Деталь не знайдено. Перевірте етикетку або введіть код вручну."
    });
    return;
  }

  const station = String(req.query.station || req.headers["x-enver-station"] || "");
  await recordScanEvent({
    partId: part.id,
    barcodeValue,
    scannedBy: req.user?.id,
    station,
    action: "viewed_3d"
  });

  const payload = await buildScanResponse(part);
  res.json(payload);
});

router.get("/:id", requireOperatorPanelView, async (req, res) => {
  const row = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  const part = {
    id: row.id,
    packageId: row.package_id,
    positionId: row.position_id,
    orderId: row.order_id,
    blockCode: row.block_code,
    partNo: row.part_no,
    partCode: row.part_code,
    partName: row.part_name,
    material: row.material,
    thickness: row.thickness,
    qty: row.qty,
    length: row.length,
    width: row.width,
    edgeCode: row.edge_code,
    note: row.note,
    barcodeValue: row.barcode_value,
    qrValue: row.qr_value,
    bazisOperationCodes: Array.isArray(row.bazis_operation_codes) ? row.bazis_operation_codes : [],
    cncStatus: row.cnc_status,
    modelNodeId: row.model_node_id,
    modelMeshName: row.model_mesh_name
  };
  res.json(await buildScanResponse(part));
});

router.get("/:id/barcode", requireOperatorPanelView, async (req, res) => {
  const row = await one(`SELECT barcode_value FROM constructive_parts WHERE id = $1`, [
    req.params.id
  ]);
  if (!row) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  if (req.query.format === "json") {
    res.json({ barcodeValue: row.barcode_value });
    return;
  }
  res.type("image/svg+xml").send(renderBarcodeSvg(row.barcode_value));
});

router.get("/:id/qr", requireOperatorPanelView, async (req, res) => {
  const row = await one(`SELECT qr_value, barcode_value FROM constructive_parts WHERE id = $1`, [
    req.params.id
  ]);
  if (!row) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  const value = row.qr_value || row.barcode_value;
  if (req.query.format === "json") {
    res.json({ qrValue: value });
    return;
  }
  const svg = await renderQrSvg(value);
  res.type("image/svg+xml").send(svg);
});

router.post("/:id/cnc/start", requireOperatorPanelView, async (req, res) => {
  const partRow = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [req.params.id]);
  if (!partRow) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  const job = await one(`SELECT id FROM cnc_jobs WHERE part_id = $1 ORDER BY id DESC LIMIT 1`, [
    partRow.id
  ]);
  if (job) {
    await updateCncJobStatus(job.id, "in_progress", req.user?.id);
  }
  await recordScanEvent({
    partId: partRow.id,
    barcodeValue: partRow.barcode_value,
    scannedBy: req.user?.id,
    station: req.body?.station || "",
    action: "started_cnc"
  });
  res.json({ ok: true, cncStatus: "in_progress" });
});

router.post("/:id/cnc/finish", requireOperatorPanelView, async (req, res) => {
  const partRow = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [req.params.id]);
  if (!partRow) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  const job = await one(`SELECT id FROM cnc_jobs WHERE part_id = $1 ORDER BY id DESC LIMIT 1`, [
    partRow.id
  ]);
  if (job) {
    await updateCncJobStatus(job.id, "done", req.user?.id);
  }
  await recordScanEvent({
    partId: partRow.id,
    barcodeValue: partRow.barcode_value,
    scannedBy: req.user?.id,
    station: req.body?.station || "",
    action: "finished_cnc"
  });
  res.json({ ok: true, cncStatus: "done" });
});

router.post("/:id/cnc/problem", requireOperatorPanelView, async (req, res) => {
  const partRow = await one(`SELECT * FROM constructive_parts WHERE id = $1`, [req.params.id]);
  if (!partRow) {
    res.status(404).json({ error: "Деталь не знайдено" });
    return;
  }
  const reason = String(req.body?.reason || "Інше");
  const job = await one(`SELECT id FROM cnc_jobs WHERE part_id = $1 ORDER BY id DESC LIMIT 1`, [
    partRow.id
  ]);
  if (job) {
    await updateCncJobStatus(job.id, "problem", req.user?.id, { problemReason: reason });
  }
  await recordScanEvent({
    partId: partRow.id,
    barcodeValue: partRow.barcode_value,
    scannedBy: req.user?.id,
    station: req.body?.station || "",
    action: "problem_reported",
    meta: { reason }
  });
  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    partRow.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: partRow.position_id,
    action: "update",
    meta: {
      summary: `Проблема ЧПК: ${partRow.part_name} — ${reason}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor: auditActor(req)
  });
  res.json({ ok: true, reasons: CNC_PROBLEM_REASONS });
});

export default router;
