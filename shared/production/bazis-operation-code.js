/** Коди операцій Bazis / ЧПК на етикетках (NC1: 0010x002x1V). */

/** Нормалізує значення зі сканера або етикетки. */
export function normalizeBazisScanCode(raw) {
  let code = String(raw || "").trim();
  if (!code) return "";
  // Символи зі сканера (GS, zero-width, керуючі)
  code = [...code]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      if (c <= 0x1f) return false;
      return c !== 0x200b && c !== 0x200c && c !== 0x200d && c !== 0xfeff;
    })
    .join("");
  // Префікси Code128 / AIM / NC1 з етикетки Bazis (GS = ASCII 29)
  const gs = String.fromCharCode(29);
  code = code.replace(/^\]C1/i, "");
  code = code.replace(new RegExp(`^[\\]${gs}>]+`, "g"), "");
  code = code.replace(/^NC1:\s*/i, "");
  code = code.replace(/\s+/g, "");
  code = code.toUpperCase();
  if (code.endsWith("V") && /^\d{3,4}X\d{3}X\d+/.test(code.slice(0, -1))) {
    code = code.slice(0, -1);
  }
  return code;
}

/** Варіанти коду для пошуку в БД і .project (різний регістр / суфікс V). */
export function bazisScanLookupVariants(raw) {
  const trimmed = String(raw || "").trim();
  const normalized = normalizeBazisScanCode(trimmed);
  const variants = new Set();
  if (trimmed) variants.add(trimmed);
  if (normalized) variants.add(normalized);
  if (trimmed) {
    variants.add(trimmed.toLowerCase());
    variants.add(trimmed.toUpperCase());
  }
  if (normalized) {
    variants.add(normalized.toLowerCase());
    variants.add(normalized.toUpperCase());
  }
  const bare = trimmed.replace(/^NC1:\s*/i, "").replace(/v$/i, "");
  if (bare) {
    variants.add(bare);
    variants.add(bare.toLowerCase());
    variants.add(bare.toUpperCase());
  }
  return [...variants].filter(Boolean);
}

/** Чи схоже значення на код операції Bazis (0010x002x1). */
export function isBazisOperationScanCode(code) {
  const n = normalizeBazisScanCode(code);
  if (/^\d{3,4}X\d{3}X\d+$/i.test(n)) return true;
  const raw = String(code || "")
    .trim()
    .replace(/^NC1:\s*/i, "");
  return /^\d{3,4}x\d{3}x\d+v?$/i.test(raw);
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

/**
 * Обирає найкращий рядок деталі серед кандидатів (дублікати part_no в різних пакетах).
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} scanCode
 */
export function pickBestPartRowForBazisScan(rows, scanCode) {
  if (!Array.isArray(rows) || !rows.length) return null;
  if (rows.length === 1) return rows[0];

  const upperVariants = new Set(
    bazisScanLookupVariants(scanCode).map((v) => String(v).toUpperCase())
  );
  const partNo = partNoFromBazisOperationCode(normalizeBazisScanCode(scanCode));

  let best = null;
  let bestScore = -1;

  for (const row of rows) {
    let score = 0;
    const codes = Array.isArray(row.bazis_operation_codes) ? row.bazis_operation_codes : [];
    if (codes.some((c) => upperVariants.has(String(c).toUpperCase()))) score += 1000;

    const pn = String(row.part_no ?? row.partNo ?? "").trim();
    const name = String(row.part_name ?? row.partName ?? "").trim();
    if (name && name !== pn && !/^\d+$/.test(name)) score += 100;
    else if (name.length > pn.length) score += 50;

    const updated = new Date(String(row.updated_at ?? row.updatedAt ?? "")).getTime();
    if (Number.isFinite(updated)) score += updated / 1e15;

    const id = Number(row.id) || 0;
    score += id / 1e9;

    if (partNo && pn && (pn === partNo || String(Number(pn)) === partNo)) score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return best;
}
