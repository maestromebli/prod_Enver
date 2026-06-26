/**
 * Розбір ЧПК-файлів для мапінгу 3D (номери деталей з імені та коментарів G-code).
 */
import { uniqueManifestNodes } from "./manifest-text.js";

/** Витягує partNo з імені файлу (B1-21.nc, деталь_3.gcode). */
function partNoFromFileName(originalName = "") {
  const base = String(originalName).replace(/\.[^.]+$/i, "");
  const blockPart = base.match(/B(\d+)[-_](\d+)/i);
  if (blockPart) return { blockCode: `B${blockPart[1]}`, partNo: blockPart[2], meshName: base };
  const tailNum = base.match(/(\d+)\s*$/);
  if (tailNum) return { partNo: tailNum[1], meshName: base };
  return { meshName: base, partNo: "" };
}

/** Парсить ЧПК-файл — manifestNodes для autoMapManifestNodes. */
export function parseCncBuffer(buffer, originalName = "") {
  const text = buffer.toString("utf8", 0, Math.min(buffer.length, 800_000));
  const manifestNodes = [];

  const fromName = partNoFromFileName(originalName);
  if (fromName.meshName) {
    manifestNodes.push({
      meshName: fromName.meshName,
      nodeId: fromName.meshName,
      partNo: fromName.partNo || "",
      blockCode: fromName.blockCode || "",
      source: "cnc_filename"
    });
  }

  const patterns = [
    /(?:\(|;)\s*(?:PART|ДЕТАЛЬ|DET|DETAIL)\s*[:\s]+([A-Za-zА-Яа-яІіЇїЄєҐґ0-9_-]+)/gi,
    /(?:\(|;)\s*([BВ]\d+[-_]\d+)/gi,
    /(?:\(|;)\s*#(\d+)\b/gi
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const token = String(m[1] || "").trim();
      if (!token) continue;
      const bp = token.match(/^B(\d+)[-_](\d+)$/i);
      if (bp) {
        manifestNodes.push({
          meshName: `B${bp[1]}-${bp[2]}`,
          nodeId: `B${bp[1]}-${bp[2]}`,
          partNo: bp[2],
          blockCode: `B${bp[1]}`,
          source: "cnc_comment"
        });
      } else if (/^\d+$/.test(token)) {
        manifestNodes.push({
          meshName: token,
          nodeId: token,
          partNo: token,
          source: "cnc_comment"
        });
      } else {
        manifestNodes.push({
          meshName: token,
          nodeId: token,
          partNo: token.replace(/^.*[-_]/, ""),
          source: "cnc_comment"
        });
      }
    }
  }

  const nodes = uniqueManifestNodes(manifestNodes);

  return {
    fileKind: "cnc_file",
    parts: [],
    materials: [],
    hardware: [],
    blocks: [],
    manifestNodes: nodes,
    warnings: nodes.length
      ? []
      : [
          `ЧПК-файл ${originalName}: не вдалося витягти номери деталей — перевірте імʼя або коментарі (PART: …)`
        ],
    extractionQuality: nodes.length ? "partial" : "poor"
  };
}
