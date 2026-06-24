import { extractTextFromBuffer } from "../../ai/file-extraction.js";

const SIZE_PATTERN = /(\d{2,4})\s*[x×хX*]\s*(\d{2,4})(?:\s*[x×хX*]\s*(\d{1,3}))?/g;
const MATERIAL_PATTERN = /(?:ДСП|МДФ|фанера|HPL|ЛДСП)[^\n]{0,40}/gi;
const EDGE_PATTERN = /(?:кромк|ПВХ|PVC|ABS)[^\n]{0,30}/gi;

function extractBlocks(text) {
  const blocks = new Set();
  const re = /(?:Б|B)\s*(\d+)/gi;
  let m;
  while ((m = re.exec(text))) {
    blocks.add(`B${m[1]}`);
  }
  return [...blocks];
}

function extractPartsFromText(text) {
  const parts = [];
  const lines = text.split(/\n|\r/);
  let currentBlock = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const blockMatch = trimmed.match(/^(?:Б|B)\s*(\d+)/i);
    if (blockMatch) currentBlock = `B${blockMatch[1]}`;

    const sizes = [...trimmed.matchAll(SIZE_PATTERN)];
    const partMatch = trimmed.match(/(?:^|\s)(\d{1,3})[.\s-]+(.{3,60})/);

    if (sizes.length && (partMatch || trimmed.length > 15)) {
      const size = sizes[0];
      const partNo = partMatch?.[1] || String(parts.length + 1);
      const partName = partMatch?.[2]?.trim() || trimmed.slice(0, 60);
      const materialMatch = trimmed.match(MATERIAL_PATTERN);
      const edgeMatch = trimmed.match(EDGE_PATTERN);

      parts.push({
        blockCode: currentBlock,
        partNo: String(partNo),
        partName,
        material: materialMatch?.[0]?.trim() || "",
        thickness: size[3] ? `${size[3]} мм` : "",
        qty: 1,
        length: size[1] || "",
        width: size[2] || "",
        edgeCode: edgeMatch?.[0]?.trim() || "",
        note: ""
      });
    }
  }

  return parts;
}

export async function parsePdfBuffer(buffer, mime, originalName) {
  const meta = await extractTextFromBuffer(buffer, mime, originalName);
  const text = meta.text || "";
  const warnings = [...(meta.warnings || [])];
  const orderMatch = text.match(/(?:замовлення|order|№)\s*[:-]?\s*([A-ZА-ЯІЇЄ0-9/-]+)/i);

  const blocks = extractBlocks(text);
  let parts = extractPartsFromText(text);

  if (!parts.length) {
    warnings.push("PDF: не знайдено рядків деталей — можливо скановане зображення");
  }

  const materials = [];
  for (const m of text.match(MATERIAL_PATTERN) || []) {
    materials.push({
      materialName: m.trim(),
      materialCode: "",
      thickness: "",
      sheetSize: "",
      qtyEstimated: "",
      unit: "",
      source: "pdf"
    });
  }

  const hardware = [];
  const hwSection = text.match(/фурнітур[\s\S]{0,2000}/i);
  if (hwSection) {
    const lines = hwSection[0].split(/\n/);
    for (const line of lines.slice(1, 30)) {
      const t = line.trim();
      if (t.length > 5) {
        hardware.push({
          blockCode: "",
          name: t.slice(0, 80),
          article: "",
          qty: "",
          unit: "шт",
          note: ""
        });
      }
    }
  }

  const extractionQuality = meta.extractionQuality || (parts.length ? "partial" : "poor");

  return {
    orderNumber: orderMatch?.[1]?.trim() || "",
    blocks: blocks.map((code) => ({ code, name: code })),
    parts,
    materials,
    hardware,
    warnings,
    extractionQuality
  };
}
