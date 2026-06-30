const ENVER3_MAGIC = Buffer.from("ENVER3");

/** Нормалізація коду деталі для зіставлення .project ↔ Базіс. */
export function normalizePartCode(code) {
  const s = String(code || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n)) return String(n);
  return s.replace(/^0+/, "") || s;
}

/** Витягнути числовий код з назви/артикулу для мʼякого зіставлення. */
export function extractNumericPartCode(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  const m = s.match(/\b(\d{1,6})\b/);
  return m ? normalizePartCode(m[1]) : "";
}

function normalizeVec3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return null;
  return [x / len, y / len, z / len];
}

function parsePanelRow(row) {
  if (!row || row.code == null) return null;
  const code = normalizePartCode(row.code);
  if (!code) return null;
  const centerMm = row.centerMm || row.center || row.positionMm;
  if (!Array.isArray(centerMm) || centerMm.length < 3) return null;
  const axisX = normalizeVec3(row.axisX);
  const axisY = normalizeVec3(row.axisY);
  const axisZ = normalizeVec3(row.axisZ);
  if (!axisX || !axisY || !axisZ) return null;
  const sizeMm = row.sizeMm || row.size;
  return {
    code,
    name: row.name ? String(row.name) : "",
    artPos: row.artPos != null ? String(row.artPos) : "",
    centerMm: centerMm.map(Number),
    sizeMm: Array.isArray(sizeMm) ? sizeMm.map(Number) : null,
    thicknessMm: row.thicknessMm != null ? Number(row.thicknessMm) : null,
    axisX,
    axisY,
    axisZ
  };
}

/** JSON збірки з Базіс (або enver-assembly.json). */
export function parseAssemblyExportJson(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  const panels = (data?.panels || []).map(parsePanelRow).filter(Boolean);
  if (!panels.length) {
    const err = new Error("У файлі збірки немає панелей з координатами");
    err.code = "EMPTY_ASSEMBLY";
    throw err;
  }
  return {
    version: Number(data?.version) || 1,
    source: data?.source || "bazis",
    exportedAt: data?.exportedAt || null,
    productName: data?.productName || null,
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
    panels
  };
}

/** Хвіст ENVER3 у кінці GibLab .b3d (додає скрипт Базіс). */
export function extractEnverAssemblyFromB3d(buffer) {
  if (!buffer?.length) return null;
  const idx = buffer.lastIndexOf(ENVER3_MAGIC);
  if (idx < 0 || idx + 14 > buffer.length) return null;
  const version = buffer.readUInt32LE(idx + 6);
  if (version !== 1) return null;
  const jsonLen = buffer.readUInt32LE(idx + 10);
  if (jsonLen <= 0 || jsonLen > 50_000_000 || idx + 14 + jsonLen > buffer.length) return null;
  try {
    const json = buffer.toString("utf8", idx + 14, idx + 14 + jsonLen);
    return parseAssemblyExportJson(json);
  } catch {
    return null;
  }
}

export function isGibLabB3d(buffer) {
  return buffer?.length >= 4 && buffer.toString("ascii", 0, 4) === "BZ85";
}

/** Дописати хвіст ENVER3 до GibLab .b3d (використовує скрипт Базіс). */
export function appendEnverAssemblyToB3d(b3dBuffer, assemblyExport) {
  const json = Buffer.from(JSON.stringify(assemblyExport), "utf8");
  const tail = Buffer.alloc(14 + json.length);
  ENVER3_MAGIC.copy(tail, 0);
  tail.writeUInt32LE(1, 6);
  tail.writeUInt32LE(json.length, 10);
  json.copy(tail, 14);

  let base = b3dBuffer;
  const idx = b3dBuffer.lastIndexOf(ENVER3_MAGIC);
  if (idx >= 0) base = b3dBuffer.subarray(0, idx);

  return Buffer.concat([base, tail]);
}
