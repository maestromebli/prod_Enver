import { computeChecksum } from "../part-code.js";

/** B3D — зберігаємо як source 3D; web viewer через GLB/GLTF. */
export function parseB3dBuffer(buffer, originalName = "") {
  const checksum = computeChecksum(buffer);
  return {
    sourceMeta: {
      originalName,
      sizeBytes: buffer.length,
      checksum,
      needsGlbExport: true
    },
    warnings: [
      "B3D збережено як вихідний 3D-файл. Для перегляду на планшеті завантажте GLB/GLTF, експортований з конструкторської програми."
    ],
    extractionQuality: "poor",
    parts: [],
    materials: [],
    hardware: [],
    modelReadiness: {
      has3dSource: true,
      needsGlbExport: true,
      format: "b3d"
    }
  };
}
