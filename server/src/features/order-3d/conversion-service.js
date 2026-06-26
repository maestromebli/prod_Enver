import { one, run } from "../../db.js";
import { b3dConverterAdapter } from "./converters/b3d-converter-adapter.js";
import { glbConverterAdapter } from "./converters/glb-converter-adapter.js";
import { meshConverterAdapter } from "./converters/mesh-converter-adapter.js";
import { wrlConverterAdapter } from "./converters/wrl-converter-adapter.js";

const CONVERTERS = [
  glbConverterAdapter,
  wrlConverterAdapter,
  b3dConverterAdapter,
  meshConverterAdapter
];

function pickConverter(fileType) {
  return CONVERTERS.find((c) => c.canHandle(fileType)) || null;
}

export async function create3DConversionJob(assetId) {
  const row = await one(
    `INSERT INTO order_3d_conversion_jobs (asset_id, status)
     VALUES ($1, 'pending')
     RETURNING *`,
    [assetId]
  );
  return row;
}

export async function mark3DConversionProgress(assetId, message) {
  await run(`UPDATE order_3d_assets SET error_message = $2, updated_at = now() WHERE id = $1`, [
    assetId,
    message
  ]);
}

export async function mark3DConversionPartialReady(
  assetId,
  webModelStoragePath,
  previewStoragePath = null,
  reportStoragePath = null,
  infoMessage = null,
  conversionSource = null
) {
  await run(
    `UPDATE order_3d_assets
     SET status = 'PARTIAL_READY',
         web_model_storage_path = $2,
         preview_storage_path = COALESCE($3, preview_storage_path),
         report_storage_path = COALESCE($4, report_storage_path),
         error_message = $5,
         conversion_source = COALESCE($6, conversion_source),
         updated_at = now()
     WHERE id = $1`,
    [
      assetId,
      webModelStoragePath,
      previewStoragePath,
      reportStoragePath,
      infoMessage,
      conversionSource
    ]
  );
}

export async function mark3DConversionReady(
  assetId,
  webModelStoragePath,
  previewStoragePath = null,
  infoMessage = null,
  reportStoragePath = null,
  conversionSource = null
) {
  await run(
    `UPDATE order_3d_assets
     SET status = 'READY',
         web_model_storage_path = $2,
         preview_storage_path = COALESCE($3, preview_storage_path),
         report_storage_path = COALESCE($4, report_storage_path),
         error_message = $5,
         conversion_source = COALESCE($6, conversion_source),
         updated_at = now()
     WHERE id = $1`,
    [
      assetId,
      webModelStoragePath,
      previewStoragePath,
      reportStoragePath,
      infoMessage,
      conversionSource
    ]
  );
}

export async function mark3DConversionFailed(assetId, errorMessage) {
  await run(
    `UPDATE order_3d_assets
     SET status = 'FAILED',
         error_message = $2,
         updated_at = now()
     WHERE id = $1`,
    [assetId, errorMessage || "Помилка конвертації"]
  );
}

export async function mark3DConversionManualCheck(assetId, errorMessage, reportStoragePath = null) {
  await run(
    `UPDATE order_3d_assets
     SET status = 'NEED_MANUAL_RESEARCH',
         error_message = $2,
         report_storage_path = COALESCE($3, report_storage_path),
         updated_at = now()
     WHERE id = $1`,
    [assetId, errorMessage || null, reportStoragePath]
  );
}

export async function process3DConversionJob(jobId) {
  const job = await one(`SELECT * FROM order_3d_conversion_jobs WHERE id = $1`, [jobId]);
  if (!job) return null;

  const asset = await one(`SELECT * FROM order_3d_assets WHERE id = $1`, [job.asset_id]);
  if (!asset) {
    await run(
      `UPDATE order_3d_conversion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [jobId, "Актив не знайдено"]
    );
    return null;
  }

  await run(
    `UPDATE order_3d_conversion_jobs SET status = 'processing', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [jobId]
  );
  await run(`UPDATE order_3d_assets SET status = 'CONVERTING', updated_at = now() WHERE id = $1`, [
    asset.id
  ]);

  const converter = pickConverter(asset.original_file_type);
  if (!converter) {
    const msg = `Немає конвертера для типу ${asset.original_file_type}`;
    await mark3DConversionFailed(asset.id, msg);
    await run(
      `UPDATE order_3d_conversion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [jobId, msg]
    );
    return { assetId: asset.id, status: "FAILED" };
  }

  try {
    if (asset.original_file_type === "b3d") {
      await mark3DConversionProgress(asset.id, "Аналіз Bazis .b3d (BZ85, zlib, ENVER3)…");
    }

    const result = await converter.convert({
      assetId: asset.id,
      orderId: asset.order_id,
      originalFileType: asset.original_file_type,
      originalStoragePath: asset.original_storage_path,
      originalFileName: asset.original_file_name
    });

    if (result.status === "READY" && result.webModelStoragePath) {
      await mark3DConversionReady(
        asset.id,
        result.webModelStoragePath,
        result.previewStoragePath,
        result.errorMessage || null,
        result.reportStoragePath || null,
        result.conversionSource || null
      );
      await run(
        `UPDATE order_3d_conversion_jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`,
        [jobId]
      );
      return { assetId: asset.id, status: "READY" };
    }

    if (result.status === "PARTIAL_READY" && result.webModelStoragePath) {
      await mark3DConversionPartialReady(
        asset.id,
        result.webModelStoragePath,
        result.previewStoragePath,
        result.reportStoragePath || null,
        result.errorMessage || null,
        result.conversionSource || null
      );
      await run(
        `UPDATE order_3d_conversion_jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = $1`,
        [jobId]
      );
      return { assetId: asset.id, status: "PARTIAL_READY" };
    }

    if (result.status === "NEED_MANUAL_RESEARCH" || result.status === "NEED_MANUAL_CHECK") {
      if (result.previewStoragePath) {
        await run(
          `UPDATE order_3d_assets
           SET preview_storage_path = COALESCE($2, preview_storage_path),
               report_storage_path = COALESCE($3, report_storage_path),
               updated_at = now()
           WHERE id = $1`,
          [asset.id, result.previewStoragePath, result.reportStoragePath || null]
        );
      }
      await mark3DConversionManualCheck(
        asset.id,
        result.errorMessage,
        result.reportStoragePath || null
      );
      await run(
        `UPDATE order_3d_conversion_jobs SET status = 'manual', last_error = $2, updated_at = now() WHERE id = $1`,
        [jobId, result.errorMessage || null]
      );
      return { assetId: asset.id, status: "NEED_MANUAL_RESEARCH" };
    }

    await mark3DConversionFailed(asset.id, result.errorMessage || "Конвертація не вдалась");
    await run(
      `UPDATE order_3d_conversion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [jobId, result.errorMessage || null]
    );
    return { assetId: asset.id, status: "FAILED" };
  } catch (err) {
    const msg = err?.message || "Помилка конвертації";
    await mark3DConversionFailed(asset.id, msg);
    await run(
      `UPDATE order_3d_conversion_jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [jobId, msg]
    );
    return { assetId: asset.id, status: "FAILED" };
  }
}

export { schedule3DConversionJob, resumePending3DConversionJobs } from "./conversion-queue.js";
