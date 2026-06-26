import path from "node:path";
import { resolveStoredPath } from "../../../file-storage.js";
import { findOrderIdForAsset } from "../constructive-context.js";
import { runFullB3DConversion } from "../b3d-node-converter.js";

/** B3D-only адаптер: Node GLB → Python research-parser → preview/report. */
export const b3dConverterAdapter = {
  canHandle(fileType) {
    return fileType === "b3d";
  },

  async convert(input) {
    const originalFull = resolveStoredPath(input.originalStoragePath);
    const outputDir = path.dirname(originalFull);
    const assetId = String(input.assetId);
    const storageBase = path.posix.dirname(input.originalStoragePath);

    let orderId = input.orderId ?? null;
    if (!orderId && input.assetId) {
      try {
        orderId = await findOrderIdForAsset(input.assetId);
      } catch {
        /* ignore */
      }
    }

    const result = await runFullB3DConversion({
      inputFullPath: originalFull,
      outputDir,
      assetId,
      storageBase,
      originalStoragePath: input.originalStoragePath,
      orderId,
      originalFileName: input.originalFileName
    });

    if (
      (result.status === "READY" || result.status === "PARTIAL_READY") &&
      result.webModelStoragePath
    ) {
      return {
        status: result.status,
        webModelStoragePath: result.webModelStoragePath,
        previewStoragePath: result.previewStoragePath || null,
        reportStoragePath: result.reportStoragePath || null,
        conversionSource: result.conversionSource || result.source || null,
        errorMessage: result.errorMessage || null
      };
    }

    if (result.status === "NEED_MANUAL_RESEARCH" || result.status === "NEED_MANUAL_CHECK") {
      return {
        status: result.status,
        previewStoragePath: result.previewStoragePath || null,
        reportStoragePath: result.reportStoragePath || null,
        errorMessage: result.errorMessage
      };
    }

    return {
      status: "FAILED",
      previewStoragePath: result.previewStoragePath || null,
      reportStoragePath: result.reportStoragePath || null,
      errorMessage: result.errorMessage || "Конвертація B3D не вдалась"
    };
  }
};
