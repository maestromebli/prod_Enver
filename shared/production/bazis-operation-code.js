/** Коди операцій Bazis / ЧПК на етикетках (NC1: 0010x002x1V). */

/** Нормалізує значення зі сканера або етикетки. */
export function normalizeBazisScanCode(raw) {
  let code = String(raw || "").trim();
  if (!code) return "";
  code = code.replace(/^NC1:\s*/i, "");
  code = code.replace(/\s+/g, "");
  code = code.toUpperCase();
  if (code.endsWith("V") && /^\d{4}X\d{3}X\d+/.test(code.slice(0, -1))) {
    code = code.slice(0, -1);
  }
  return code;
}

/** Чи схоже значення на код операції Bazis (0010x002x1). */
export function isBazisOperationScanCode(code) {
  const n = normalizeBazisScanCode(code);
  return /^\d{3,4}X\d{3}X\d+$/i.test(n);
}

/** Номер деталі з коду операції: 0010x002x1 → 10. */
export function partNoFromBazisOperationCode(code) {
  const n = normalizeBazisScanCode(code);
  const m = n.match(/^0*(\d+)X/i);
  if (!m) return "";
  return String(Number(m[1]));
}

/** Витягує всі коди <operation code="…"> з тексту .project. */
export function extractBazisOperationCodesFromProjectText(text) {
  const codes = [];
  const re = /<operation([^>]*)>/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const attrs = m[1] || "";
    const attrRe = /(?:^|\s)code\s*=\s*["']([^"']*)["']/i;
    const am = attrs.match(attrRe);
    const code = am?.[1]?.trim();
    if (code) codes.push(normalizeBazisScanCode(code));
  }
  return [...new Set(codes.filter(Boolean))];
}

/** Групує коди операцій за partNo (перший сегмент до x). */
export function groupBazisOperationCodesByPartNo(codes = []) {
  const map = new Map();
  for (const raw of codes) {
    const code = normalizeBazisScanCode(raw);
    const partNo = partNoFromBazisOperationCode(code);
    if (!partNo) continue;
    if (!map.has(partNo)) map.set(partNo, []);
    const list = map.get(partNo);
    if (!list.includes(code)) list.push(code);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  return map;
}

/** Імʼя mesh для підсвітки деталі в GLB (panel-10, B1-21, …). */
export function resolvePartHighlightMesh(part) {
  if (!part) return null;
  if (part.modelMeshName || part.modelNodeId) {
    return {
      meshName: part.modelMeshName || part.modelNodeId,
      nodeId: part.modelNodeId || part.modelMeshName
    };
  }
  const partNo = String(part.partNo || "").trim();
  if (partNo) {
    return { meshName: `panel-${partNo}`, nodeId: partNo };
  }
  const code = String(part.partCode || "").trim();
  if (!code) return null;
  return { meshName: `panel-${code}`, nodeId: `panel-${code}` };
}
