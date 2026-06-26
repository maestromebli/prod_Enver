import { computeChecksum } from "../part-code.js";
import {
  collectPrintableStrings,
  extractBlockPartTokens,
  manifestNodesFromStrings,
  uniqueManifestNodes
} from "./manifest-text.js";

/** GibLab .b3d — джерело 3D-вузлів для мапінгу (разом із .project). */
export function parseB3dBuffer(buffer, originalName = "") {
  const checksum = computeChecksum(buffer);
  const strings = collectPrintableStrings(buffer);
  const joined = strings.join("\n");
  const extra = [];

  const manifestNodes = uniqueManifestNodes([
    ...manifestNodesFromStrings(strings, "b3d_string"),
    ...extractBlockPartTokens(joined, "b3d_text")
  ]);

  for (const s of strings) {
    const nameMatch = s.match(/^(?:Name|Назва|Article|Артикул)\s*[:=]\s*(.+)$/i);
    if (nameMatch) {
      const label = nameMatch[1].trim();
      extra.push({
        meshName: label,
        nodeId: label,
        partNo: label.replace(/^.*[-_]/, ""),
        source: "b3d_meta"
      });
    }
  }

  const uniqueNodes = uniqueManifestNodes([...manifestNodes, ...extra]);

  return {
    fileKind: "b3d",
    sourceMeta: {
      originalName,
      sizeBytes: buffer.length,
      checksum,
      format: "giblab_b3d"
    },
    warnings: uniqueNodes.length
      ? []
      : [
          `B3D ${originalName}: не вдалося витягти імена деталей — перевірте пару з файлом .project`
        ],
    extractionQuality: uniqueNodes.length ? "partial" : "poor",
    parts: [],
    materials: [],
    hardware: [],
    manifestNodes: uniqueNodes,
    modelReadiness: {
      has3dSource: true,
      needsGlbExport: false,
      format: "giblab_b3d"
    }
  };
}
