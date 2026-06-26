import { computeChecksum } from "../part-code.js";
import {
  collectPrintableStrings,
  manifestNodesFromProjectXml,
  manifestNodesFromStrings,
  uniqueManifestNodes
} from "./manifest-text.js";
import { decodeProjectText } from "./project-text.js";

/** .project конструктора — структура деталей для мапінгу 3D (разом із GibLab .b3d). */
export function parseProjectBuffer(buffer, originalName = "") {
  const checksum = computeChecksum(buffer);
  const text = decodeProjectText(buffer);

  const hasXml = text.includes("<?xml") || /<(?:Part|Panel|Item|Project|Module)\b/i.test(text);
  let parts = [];
  let manifestNodes = [];

  if (hasXml) {
    const parsed = manifestNodesFromProjectXml(text, "project_xml");
    parts = parsed.parts;
    manifestNodes = parsed.manifestNodes;
  }

  if (!manifestNodes.length) {
    const strings = collectPrintableStrings(buffer);
    manifestNodes = manifestNodesFromStrings(strings, "project_string");
  }

  manifestNodes = uniqueManifestNodes(manifestNodes);

  const warnings = [];
  if (!parts.length && !manifestNodes.length) {
    warnings.push(
      "Файл .project збережено. Для мапінгу 3D потрібен також GibLab .b3d — автоматичний розбір структури обмежений."
    );
  }

  return {
    fileKind: "project",
    sourceMeta: {
      originalName,
      sizeBytes: buffer.length,
      checksum,
      detectedFormat: hasXml ? "xml-like" : "binary"
    },
    warnings,
    extractionQuality: parts.length || manifestNodes.length ? "partial" : "poor",
    parts,
    materials: [],
    hardware: [],
    manifestNodes,
    modelReadiness: {
      has3dSource: true,
      format: "project"
    }
  };
}
