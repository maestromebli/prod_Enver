import { computeChecksum } from "../part-code.js";
import {
  extractBlockPartTokens,
  manifestNodesFromStrings,
  uniqueManifestNodes
} from "./manifest-text.js";
import { analyzeBazisB3dBuffer } from "../bazis-b3d-decoder.js";

/** Bazis / GibLab .b3d — декодування BZ85 + вузли для мапінгу. */
export function parseB3dBuffer(buffer, originalName = "") {
  const checksum = computeChecksum(buffer);
  const decoded = analyzeBazisB3dBuffer(buffer);
  const strings = decoded.strings || [];
  const joined = strings.join("\n");
  const extra = [];

  const manifestNodes = uniqueManifestNodes([
    ...manifestNodesFromStrings(strings, "b3d_string"),
    ...extractBlockPartTokens(joined, "b3d_text"),
    ...decoded.panels.map((p, idx) => ({
      meshName: p.meshName || `panel-${p.code || idx + 1}`,
      nodeId: p.meshName || String(p.code || idx + 1),
      partNo: String(p.code || p.partNo || idx + 1),
      blockCode: p.blockCode || "",
      source: "b3d_decode"
    }))
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
  const isBazis = decoded.isBazis;

  return {
    fileKind: "b3d",
    sourceMeta: {
      originalName,
      sizeBytes: buffer.length,
      checksum,
      format: isBazis ? "bazis_bz85" : "giblab_b3d",
      b3dDecode: decoded.stats || null
    },
    warnings: [
      ...decoded.warnings,
      ...(uniqueNodes.length
        ? []
        : [
            `B3D ${originalName}: не вдалося витягти імена деталей — перевірте пару з файлом .project`
          ])
    ],
    extractionQuality: decoded.panels.length
      ? decoded.stats?.posedPanelCount
        ? "good"
        : "partial"
      : uniqueNodes.length
        ? "partial"
        : "poor",
    parts: decoded.panels.map((p) => ({
      blockCode: p.blockCode || "",
      partNo: String(p.partNo || p.code || ""),
      partName: p.name || "",
      material: p.material || "",
      thickness: String(p.thicknessMm || ""),
      length: String(p.lengthMm || ""),
      width: String(p.widthMm || ""),
      edgeCode: "",
      qty: 1,
      note: "",
      source: "b3d_decode"
    })),
    materials: [],
    hardware: [],
    manifestNodes: uniqueNodes,
    modelReadiness: {
      has3dSource: Boolean(decoded.panels.length || uniqueNodes.length),
      needsGlbExport: !decoded.stats?.posedPanelCount,
      format: isBazis ? "bazis_bz85" : "giblab_b3d"
    }
  };
}
