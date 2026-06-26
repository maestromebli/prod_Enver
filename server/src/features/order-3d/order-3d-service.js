import { all, one, run } from "../../db.js";
import {
  canDelete3DAsset,
  canUpload3DAsset,
  canViewB3DReport,
  canViewOriginalB3D,
  canViewWebModel,
  conversionSourceLabel,
  detectOrder3DFileType,
  isOrder3DUploadAllowed,
  ORDER_3D_MAX_BYTES
} from "../../../../shared/production/order-3d.js";
import {
  create3DConversionJob
} from "./conversion-service.js";
import { schedule3DConversionJob } from "./conversion-queue.js";
import { findConstructiveContextForOrder } from "./constructive-context.js";
import {
  buildPatchedB3dWithEnver3,
  loadAssemblyExportFromJsonBuffer
} from "../../constructive/b3d-auto-enver3.js";
import {
  deleteStoredFile,
  uploadOrder3DFile
} from "./order-3d-storage.js";

function pathBasename(storagePath = "") {
  const normalized = String(storagePath).replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

function assertOrderAccess(user) {
  if (!canViewWebModel(user) && !canUpload3DAsset(user)) {
    const err = new Error("Недостатньо прав для перегляду 3D-моделі");
    err.status = 403;
    throw err;
  }
}

export function mapOrder3DAssetRow(row, user, { orderId } = {}) {
  if (!row) return null;
  const showOriginal = canViewOriginalB3D(user);
  const webPath = row.web_model_storage_path || "";
  const webExt = webPath ? detectOrder3DFileType(pathBasename(webPath)) : null;
  const webModelFormat =
    webExt && webExt !== "unknown" ? webExt : row.original_file_type || "glb";
  return {
    id: row.id,
    orderId: row.order_id,
    originalFileName: row.original_file_name,
    originalFileType: row.original_file_type,
    status: row.status,
    errorMessage: row.error_message || null,
    conversionHint:
      row.status === "READY" || row.status === "PARTIAL_READY"
        ? row.error_message || conversionSourceLabel(row.conversion_source) || null
        : null,
    conversionSource: row.conversion_source || null,
    conversionSourceLabel: conversionSourceLabel(row.conversion_source),
    isPartialGeometry: row.status === "PARTIAL_READY",
    webModelFormat: webModelFormat === "unknown" ? "glb" : webModelFormat,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originalFileUrl: showOriginal ? `/api/orders/${orderId || row.order_id}/3d/${row.id}/original` : null,
    webModelUrl: row.web_model_storage_path
      ? `/api/orders/${orderId || row.order_id}/3d/${row.id}/web-model`
      : null,
    previewImageUrl: row.preview_storage_path
      ? `/api/orders/${orderId || row.order_id}/3d/${row.id}/preview`
      : null,
    reportUrl:
      row.report_storage_path && canViewB3DReport(user)
        ? `/api/orders/${orderId || row.order_id}/3d/${row.id}/report`
        : null,
    permissions: {
      canViewOriginal: showOriginal,
      canDownloadWebModel: Boolean(row.web_model_storage_path),
      canDelete: canDelete3DAsset(user),
      canRetry: canUpload3DAsset(user)
    }
  };
}

export async function getProject3DAsset(orderId, user) {
  assertOrderAccess(user);
  const row = await one(
    `SELECT * FROM order_3d_assets WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );
  return mapOrder3DAssetRow(row, user, { orderId });
}

export async function getOrder3DAssetById(assetId) {
  return one(`SELECT * FROM order_3d_assets WHERE id = $1`, [assetId]);
}

export async function createProject3DAsset(orderId, file, user) {
  if (!canUpload3DAsset(user)) {
    const err = new Error("Недостатньо прав для завантаження 3D-моделі");
    err.status = 403;
    throw err;
  }

  const order = await one(`SELECT id FROM orders WHERE id = $1`, [orderId]);
  if (!order) {
    const err = new Error("Замовлення не знайдено");
    err.status = 404;
    throw err;
  }

  const { buffer, originalName, mime } = file;
  if (!buffer?.length) {
    const err = new Error("Порожній файл");
    err.status = 400;
    throw err;
  }
  if (buffer.length > ORDER_3D_MAX_BYTES) {
    const err = new Error("Файл завеликий для завантаження");
    err.status = 400;
    throw err;
  }
  if (!isOrder3DUploadAllowed(originalName)) {
    const err = new Error("Непідтримуваний формат файлу");
    err.status = 400;
    throw err;
  }

  const fileType = detectOrder3DFileType(originalName);
  let uploadBuffer = buffer;

  if (fileType === "b3d") {
    try {
      const ctx = await findConstructiveContextForOrder(orderId, { b3dFileName: originalName });
      if (ctx?.assemblyJsonBuffer?.length) {
        const assembly = await loadAssemblyExportFromJsonBuffer(ctx.assemblyJsonBuffer);
        const patched = await buildPatchedB3dWithEnver3(buffer, assembly);
        if (patched?.buffer && !patched.alreadyPresent) {
          uploadBuffer = patched.buffer;
        }
      }
    } catch {
      /* ignore auto ENVER3 */
    }
  }

  const saved = await uploadOrder3DFile(orderId, { buffer: uploadBuffer, originalName, mime });

  const oldRows = await all(`SELECT * FROM order_3d_assets WHERE order_id = $1`, [orderId]);
  for (const old of oldRows) {
    await deleteProject3DAsset(old.id, user, { skipPermission: true, skipNotFound: true });
  }

  let status = "UPLOADED";
  let webModelPath = null;
  let previewPath = null;

  if (fileType === "glb" || fileType === "gltf") {
    status = "READY";
    webModelPath = saved.storagePath;
  } else if (fileType === "wrl") {
    status = "READY";
    webModelPath = saved.storagePath;
  } else if (fileType === "jpg" || fileType === "png") {
    status = "READY";
    previewPath = saved.storagePath;
  } else if (fileType === "b3d" || fileType === "obj" || fileType === "stl") {
    status = "CONVERTING";
  }

  const row = await one(
    `INSERT INTO order_3d_assets
     (order_id, original_storage_path, original_file_name, original_file_type,
      web_model_storage_path, preview_storage_path, status, error_message, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      orderId,
      saved.storagePath,
      saved.originalName,
      fileType,
      webModelPath,
      previewPath,
      status,
      fileType === "wrl" ? "VRML-збірка з Базіс (.wrl)" : null,
      user?.id || null
    ]
  );

  if (status === "CONVERTING") {
    const job = await create3DConversionJob(row.id);
    schedule3DConversionJob(job.id);
  }

  return mapOrder3DAssetRow(row, user, { orderId });
}

export async function updateProject3DStatus(assetId, status, data = {}) {
  await run(
    `UPDATE order_3d_assets
     SET status = $2,
         web_model_storage_path = COALESCE($3, web_model_storage_path),
         preview_storage_path = COALESCE($4, preview_storage_path),
         error_message = COALESCE($5, error_message),
         updated_at = now()
     WHERE id = $1`,
    [
      assetId,
      status,
      data.webModelStoragePath ?? null,
      data.previewStoragePath ?? null,
      data.errorMessage ?? null
    ]
  );
}

export async function retryProject3DConversion(assetId, user) {
  if (!canUpload3DAsset(user)) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }

  const asset = await getOrder3DAssetById(assetId);
  if (!asset) {
    const err = new Error("3D-актив не знайдено");
    err.status = 404;
    throw err;
  }

  if (!["FAILED", "NEED_MANUAL_CHECK", "NEED_MANUAL_RESEARCH"].includes(asset.status)) {
    const err = new Error("Повторна обробка доступна лише після помилки");
    err.status = 409;
    throw err;
  }

  await run(
    `UPDATE order_3d_assets SET status = 'CONVERTING', error_message = NULL, updated_at = now() WHERE id = $1`,
    [assetId]
  );
  const job = await create3DConversionJob(assetId);
  schedule3DConversionJob(job.id);

  const updated = await getOrder3DAssetById(assetId);
  return mapOrder3DAssetRow(updated, user, { orderId: asset.order_id });
}

export async function deleteProject3DAsset(assetId, user, options = {}) {
  if (!options.skipPermission && !canDelete3DAsset(user)) {
    const err = new Error("Недостатньо прав для видалення 3D-моделі");
    err.status = 403;
    throw err;
  }

  const asset = await getOrder3DAssetById(assetId);
  if (!asset) {
    if (options.skipNotFound) return null;
    const err = new Error("3D-актив не знайдено");
    err.status = 404;
    throw err;
  }

  const paths = new Set(
    [
      asset.original_storage_path,
      asset.web_model_storage_path,
      asset.preview_storage_path,
      asset.report_storage_path
    ].filter(Boolean)
  );
  for (const p of paths) {
    await deleteStoredFile(p);
  }

  await run(`DELETE FROM order_3d_conversion_jobs WHERE asset_id = $1`, [assetId]);
  await run(`DELETE FROM order_3d_assets WHERE id = $1`, [assetId]);
  return { deleted: true, id: assetId };
}

export async function attachWebModelToAsset(orderId, assetId, file, user) {
  if (!canUpload3DAsset(user)) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }
  const fileType = detectOrder3DFileType(file.originalName);
  if (fileType !== "glb" && fileType !== "gltf" && fileType !== "wrl") {
    const err = new Error("Для перегляду потрібен файл .glb, .gltf або .wrl");
    err.status = 400;
    throw err;
  }

  const asset = await getOrder3DAssetById(assetId);
  if (!asset || asset.order_id !== orderId) {
    const err = new Error("3D-актив не знайдено");
    err.status = 404;
    throw err;
  }

  const saved = await uploadOrder3DFile(orderId, file);
  await run(
    `UPDATE order_3d_assets
     SET web_model_storage_path = $2, status = 'READY', error_message = NULL, updated_at = now()
     WHERE id = $1`,
    [assetId, saved.storagePath]
  );

  const updated = await getOrder3DAssetById(assetId);
  return mapOrder3DAssetRow(updated, user, { orderId });
}
