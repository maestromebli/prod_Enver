/** @typedef {{ assetId: number; originalFileType: string; originalStoragePath: string; originalFileName: string }} ConvertInput */

/** @typedef {{ status: "READY" | "FAILED" | "NEED_MANUAL_CHECK"; webModelStoragePath?: string; previewStoragePath?: string; errorMessage?: string }} ConvertResult */

/**
 * @typedef {Object} ModelConverter
 * @property {(fileType: string) => boolean} canHandle
 * @property {(input: ConvertInput) => Promise<ConvertResult>} convert
 */

export const CONVERTER_STUB_MESSAGE =
  "B3D conversion adapter is not connected yet. Attach Windows Converter Worker or external B3D to GLB service.";
