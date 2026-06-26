import fs from "node:fs/promises";
import path from "node:path";
import {
  extractGlbFromB3d,
  extractPackagePreviewGlb
} from "../../constructive/b3d-glb-extractor.js";
import { readStoredFile } from "../../file-storage.js";
import { findConstructiveContextForOrder } from "./constructive-context.js";
import { converterAvailable, runB3DConverter } from "./b3d-conversion-client.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** @typedef {"READY" | "PARTIAL_READY" | "NEED_MANUAL_CHECK" | "FAILED"} B3DNodeStatus */

/**
 * @typedef {Object} B3DNodeConvertResult
 * @property {B3DNodeStatus} status
 * @property {Buffer} [glbBuffer]
 * @property {Buffer} [previewBuffer]
 * @property {string} [source]
 * @property {number|null} [panelCount]
 * @property {string} [layout]
 * @property {boolean} [isFallback]
 * @property {string} [errorMessage]
 */

function extractEmbeddedPng(buffer) {
  if (!buffer?.length) return null;
  const start = buffer.indexOf(PNG_SIGNATURE);
  if (start < 0) return null;
  const end = buffer.indexOf(PNG_IEND, start);
  if (end < 0) return null;
  return buffer.subarray(start, end + PNG_IEND.length);
}

/**
 * B3D-only конвертація: вбудований GLB → .project з пакета → парсинг .b3d → Python worker.
 * @param {Object} input
 * @param {Buffer} input.b3dBuffer
 * @param {number} [input.orderId]
 * @param {string} [input.productName]
 * @returns {Promise<B3DNodeConvertResult>}
 */
export async function convertB3dWithNode({ b3dBuffer, orderId, productName = "", b3dFileName = "" }) {
  if (!b3dBuffer?.length) {
    return { status: "FAILED", errorMessage: "Порожній файл .b3d" };
  }

  const previewBuffer = extractEmbeddedPng(b3dBuffer);
  let ctx = null;

  if (orderId) {
    try {
      ctx = await findConstructiveContextForOrder(orderId, {
        b3dFileName: b3dFileName || productName
      });
    } catch {
      /* ignore DB errors in conversion */
    }
  }

  if (ctx?.existingGlbBuffer?.length) {
    return {
      status: "READY",
      glbBuffer: ctx.existingGlbBuffer,
      previewBuffer,
      source: "constructive_package_glb",
      panelCount: null,
      layout: "flat",
      isFallback: false
    };
  }

  if (ctx?.projectBuffer?.length) {
    try {
      const built = extractPackagePreviewGlb({
        b3dBuffer,
        projectBuffer: ctx.projectBuffer,
        assemblyJsonBuffer: ctx.assemblyJsonBuffer,
        productName: productName || ctx.projectName || ""
      });
      const isFallback = built.layout === "flat" && built.source === "project_panels";
      return {
        status: isFallback ? "PARTIAL_READY" : "READY",
        glbBuffer: built.buffer,
        previewBuffer,
        source: built.source,
        panelCount: built.panelCount ?? null,
        layout: built.layout || "flat",
        isFallback
      };
    } catch {
      /* fallback нижче */
    }
  }

  try {
    const fromB3d = extractGlbFromB3d(b3dBuffer, { productName });
    return {
      status: fromB3d.source === "b3d_xml_panels" ? "PARTIAL_READY" : "READY",
      glbBuffer: fromB3d.buffer,
      previewBuffer,
      source: fromB3d.source,
      panelCount: fromB3d.panelCount ?? null,
      layout: fromB3d.source === "b3d_xml_panels" ? "flat" : "assembly",
      isFallback: fromB3d.source === "b3d_xml_panels"
    };
  } catch (err) {
    return {
      status: "NEED_MANUAL_CHECK",
      previewBuffer,
      errorMessage:
        err?.message ||
        "Не вдалося зібрати 3D з .b3d. Спробуємо Python-парсер або додайте .project у пакет конструктива."
    };
  }
}

/**
 * @param {Object} params
 * @param {string} params.outputDir
 * @param {string} params.assetId
 * @param {string} params.storageBase
 * @param {B3DNodeConvertResult & { reportBuffer?: Buffer }} params.result
 */
export async function writeB3dConversionOutputs({ outputDir, assetId, storageBase, result }) {
  const rel = (name) => (storageBase ? path.posix.join(storageBase, name) : null);

  if (result.previewBuffer?.length) {
    await fs.writeFile(path.join(outputDir, `${assetId}.preview.png`), result.previewBuffer);
  }

  let webModelStoragePath;
  if (result.glbBuffer?.length) {
    const name = `${assetId}.glb`;
    await fs.writeFile(path.join(outputDir, name), result.glbBuffer);
    webModelStoragePath = rel(name);
  }

  let reportStoragePath;
  if (result.reportBuffer?.length) {
    const name = `${assetId}.report.json`;
    await fs.writeFile(path.join(outputDir, name), result.reportBuffer);
    reportStoragePath = rel(name);
  }

  return {
    webModelStoragePath,
    previewStoragePath: result.previewBuffer?.length ? rel(`${assetId}.preview.png`) : undefined,
    reportStoragePath
  };
}

/**
 * Повний B3D-only пайплайн: Node → Python worker → preview-only.
 */
export async function runFullB3DConversion(input) {
  let b3dBuffer;
  try {
    if (input.originalStoragePath) {
      b3dBuffer = await readStoredFile(input.originalStoragePath);
    } else {
      b3dBuffer = await fs.readFile(input.inputFullPath);
    }
  } catch {
    b3dBuffer = await fs.readFile(input.inputFullPath);
  }

  const nodeResult = await convertB3dWithNode({
    b3dBuffer,
    orderId: input.orderId,
    productName: input.originalFileName?.replace(/\.b3d$/i, "") || "",
    b3dFileName: input.originalFileName || ""
  });

  if (nodeResult.status === "READY" || nodeResult.status === "PARTIAL_READY") {
    const paths = await writeB3dConversionOutputs({
      outputDir: input.outputDir,
      assetId: input.assetId,
      storageBase: input.storageBase,
      result: nodeResult
    });
    const panelHint =
      nodeResult.panelCount != null ? ` (${nodeResult.panelCount} панелей)` : "";
    const isPartial = nodeResult.status === "PARTIAL_READY" || nodeResult.isFallback;
    return {
      status: isPartial ? "PARTIAL_READY" : "READY",
      ...paths,
      isFallback: nodeResult.isFallback,
      conversionSource: nodeResult.source,
      source: nodeResult.source,
      panelCount: nodeResult.panelCount,
      errorMessage: isPartial
        ? `Експериментальна 3D-модель з .b3d${panelHint} — геометрія може бути неповною.`
        : nodeResult.panelCount != null
          ? `3D-модель зібрано з .b3d${panelHint}.`
          : null
    };
  }

  if (converterAvailable()) {
    const py = await runB3DConverter({
      inputFullPath: input.inputFullPath,
      outputDir: input.outputDir,
      assetId: input.assetId,
      storageBase: input.storageBase
    });

    if ((py.status === "READY" || py.status === "PARTIAL_READY") && py.webModelStoragePath) {
      return {
        status: py.status,
        webModelStoragePath: py.webModelStoragePath,
        previewStoragePath: py.previewStoragePath,
        reportStoragePath: py.reportStoragePath,
        isFallback: py.isFallback,
        conversionSource: py.conversionSource || "python_b3d_converter",
        source: "python_b3d_converter",
        errorMessage: py.isFallback
          ? "Експериментальна fallback-модель з Python B3D-парсера — не точна геометрія."
          : null
      };
    }

    if (py.previewStoragePath || nodeResult.previewBuffer?.length) {
      if (nodeResult.previewBuffer?.length && !py.previewStoragePath) {
        await writeB3dConversionOutputs({
          outputDir: input.outputDir,
          assetId: input.assetId,
          storageBase: input.storageBase,
          result: { previewBuffer: nodeResult.previewBuffer }
        });
      }
      return {
        status: "NEED_MANUAL_RESEARCH",
        previewStoragePath:
          py.previewStoragePath ||
          path.posix.join(input.storageBase, `${input.assetId}.preview.png`),
        reportStoragePath: py.reportStoragePath,
        errorMessage:
          py.errorMessage ||
          nodeResult.errorMessage ||
          "Знайдено PNG-превʼю та report.json, але надійну 3D-геометрію не зібрано."
      };
    }
  }

  if (nodeResult.previewBuffer?.length) {
    const paths = await writeB3dConversionOutputs({
      outputDir: input.outputDir,
      assetId: input.assetId,
      storageBase: input.storageBase,
      result: { previewBuffer: nodeResult.previewBuffer }
    });
    return {
      status: "NEED_MANUAL_RESEARCH",
      previewStoragePath: paths.previewStoragePath,
      errorMessage: nodeResult.errorMessage
    };
  }

  return {
    status: "FAILED",
    errorMessage: nodeResult.errorMessage || "Конвертація B3D не вдалась"
  };
}
