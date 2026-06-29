/** Метрики пакета конструктива для оцінки часу етапів цеху. */

export function parseDimensionMm(value) {
  const s = String(value ?? "")
    .trim()
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** Скільки сторін кромкується за edge_code (0/1 маски або непорожній код). */
export function countEdgedSides(edgeCode) {
  const code = String(edgeCode || "").trim();
  if (!code || /^0+$/i.test(code) || /^(none|немає|—|-)$/i.test(code)) return 0;
  const digits = code.replace(/\D/g, "");
  if (digits.length >= 4) {
    return [...digits.slice(0, 4)].filter((d) => d !== "0").length;
  }
  if (digits.length) return digits.split("").filter((d) => d !== "0").length;
  return 2;
}

export function computePartPerimeterMm(part) {
  const l = parseDimensionMm(part.length);
  const w = parseDimensionMm(part.width);
  if (l && w) return 2 * (l + w);
  return 0;
}

function edgeLengthForPart(l, w, sides) {
  if (!l || !w || !sides) return 0;
  if (sides >= 4) return 2 * (l + w);
  if (sides === 3) return l + 2 * w;
  if (sides === 2) return l + w;
  return Math.min(l, w);
}

/**
 * @param {Array<{ length?, width?, qty?, edgeCode?, edge_code?, material?, partName? }>} parts
 * @param {Array<{ name?, qty?, qtyEstimated? }>} hardware
 */
export function computePackageStageMetrics(parts = [], hardware = []) {
  let partsCount = 0;
  let cutLengthMm = 0;
  let edgeLengthMm = 0;
  let drillPoints = 0;
  const materials = new Set();

  for (const p of parts) {
    const qty = Math.max(1, Number(p.qty) || 1);
    partsCount += qty;
    const l = parseDimensionMm(p.length);
    const w = parseDimensionMm(p.width);
    const perimeter = l && w ? 2 * (l + w) : 0;
    cutLengthMm += perimeter * qty;
    const sides = countEdgedSides(p.edgeCode || p.edge_code);
    edgeLengthMm += edgeLengthForPart(l, w, sides) * qty;
    drillPoints += qty * Math.max(2, sides * 2);
    const mat = String(p.material || "").trim();
    if (mat) materials.add(mat);
  }

  const hwCount = hardware.reduce((sum, h) => {
    const q = Number(String(h.qty || h.qtyEstimated || "1").replace(",", "."));
    return sum + (Number.isFinite(q) && q > 0 ? Math.ceil(q) : 1);
  }, hardware.length);

  return {
    partsCount,
    cutLengthMm: Math.round(cutLengthMm),
    edgeLengthMm: Math.round(edgeLengthMm),
    drillPoints,
    hardwareCount: hwCount,
    materialSummary: [...materials].slice(0, 6).join(", ")
  };
}
