import crypto from "crypto";

/** Мінімальний парсер метаданих GibLab / KDT-проєкту з тексту або meta.json. */

export function hashGiblabContent(text) {
  return crypto
    .createHash("sha256")
    .update(String(text || ""))
    .digest("hex")
    .slice(0, 16);
}

export function parseGiblabText(content, fileName = "") {
  const text = String(content || "");
  const summary = {
    fileName,
    piecesTotal: 0,
    cutLengthMm: 0,
    materials: [],
    panels: []
  };

  const piecePatterns = [
    /кількість\s*[:=]\s*(\d+)/gi,
    /quantity\s*[:=]\s*(\d+)/gi,
    /count\s*[:=]\s*(\d+)/gi,
    /деталей\s*[:=]\s*(\d+)/gi
  ];
  for (const re of piecePatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      summary.piecesTotal = Math.max(summary.piecesTotal, Number(m[1]) || 0);
    }
  }

  const lengthPatterns = [
    /довжин[аи]\s*різу\s*[:=]\s*([\d.,]+)\s*(мм|mm|м|m)?/gi,
    /cut\s*length\s*[:=]\s*([\d.,]+)\s*(mm|m)?/gi,
    /perimeter\s*[:=]\s*([\d.,]+)/gi
  ];
  for (const re of lengthPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      let val = Number(String(m[1]).replace(",", ".")) || 0;
      const unit = String(m[2] || "mm").toLowerCase();
      if (unit === "m") val *= 1000;
      summary.cutLengthMm = Math.max(summary.cutLengthMm, Math.round(val));
    }
  }

  const materialPatterns = [
    /матеріал\s*[:=]\s*([^\n\r;]+)/gi,
    /material\s*[:=]\s*([^\n\r;]+)/gi,
    /decors?\s*[:=]\s*([^\n\r;]+)/gi
  ];
  const materials = new Set();
  for (const re of materialPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = String(m[1]).trim();
      if (v.length >= 2) materials.add(v);
    }
  }
  summary.materials = [...materials];

  const panelRe = /<panel[^>]*name=["']([^"']+)["'][^>]*>/gi;
  let panelMatch;
  while ((panelMatch = panelRe.exec(text)) !== null) {
    summary.panels.push({ name: panelMatch[1] });
    summary.piecesTotal = Math.max(summary.piecesTotal, summary.panels.length);
  }

  if (!summary.piecesTotal && summary.panels.length) {
    summary.piecesTotal = summary.panels.length;
  }

  return summary;
}

export function mergeGiblabSummary(meta = {}, giblabSummary = {}, fileSummary = {}) {
  return {
    orderNumber: meta.orderNumber || "",
    object: meta.object || "",
    client: meta.client || "",
    material: meta.material || fileSummary.materials?.[0] || "",
    piecesTotal:
      Number(meta.piecesTotal) ||
      Number(giblabSummary.piecesTotal) ||
      Number(fileSummary.piecesTotal) ||
      (Array.isArray(meta.items) ? meta.items.length : 0),
    cutLengthMm: Number(giblabSummary.cutLengthMm) || Number(fileSummary.cutLengthMm) || 0,
    items: meta.items || [],
    giblabFile: meta.giblabFile || fileSummary.fileName || "",
    giblabHash: fileSummary.hash || ""
  };
}
