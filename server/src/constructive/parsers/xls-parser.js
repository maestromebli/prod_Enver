/**
 * XLS/XLSX parser — матеріали та фурнітура зі специфікації.
 * Використовує простий парсинг через xlsx (якщо доступний) або fallback.
 */

function cellStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

function parseSheetRows(sheet) {
  if (!sheet || !Array.isArray(sheet)) return [];
  return sheet.filter((row) => Array.isArray(row) && row.some((c) => cellStr(c)));
}

function looksLikeMaterialHeader(row) {
  const joined = row.map(cellStr).join(" ").toLowerCase();
  return (
    joined.includes("матеріал") ||
    joined.includes("material") ||
    joined.includes("товщ") ||
    joined.includes("лист")
  );
}

function looksLikeHardwareHeader(row) {
  const joined = row.map(cellStr).join(" ").toLowerCase();
  return (
    joined.includes("фурнітур") ||
    joined.includes("hardware") ||
    joined.includes("артикул") ||
    joined.includes("article")
  );
}

function extractFromRows(rows) {
  const materials = [];
  const hardware = [];
  const warnings = [];
  let mode = null;

  for (const row of rows) {
    const cells = row.map(cellStr);
    if (!cells.some(Boolean)) continue;

    if (looksLikeMaterialHeader(cells)) {
      mode = "material";
      continue;
    }
    if (looksLikeHardwareHeader(cells)) {
      mode = "hardware";
      continue;
    }

    if (mode === "material" && cells[0]) {
      materials.push({
        materialName: cells[0] || cells[1] || "",
        materialCode: cells[1] || "",
        thickness: cells[2] || cells[3] || "",
        sheetSize: cells[3] || cells[4] || "",
        qtyEstimated: cells[4] || cells[5] || cells[2] || "",
        unit: cells[5] || cells[6] || "шт",
        source: "xls"
      });
    } else if (mode === "hardware" && (cells[0] || cells[1])) {
      hardware.push({
        blockCode: cells[0]?.match(/^Б\d/i) ? cells[0] : "",
        name: cells[0]?.match(/^Б\d/i) ? cells[1] || cells[0] : cells[0],
        article: cells[1] || cells[2] || "",
        qty: cells[2] || cells[3] || "",
        unit: cells[3] || cells[4] || "шт",
        note: cells[4] || cells[5] || ""
      });
    } else if (cells.length >= 3) {
      const lower = cells.join(" ").toLowerCase();
      if (lower.includes("дсп") || lower.includes("мдф") || lower.includes("фанер")) {
        materials.push({
          materialName: cells[0],
          materialCode: "",
          thickness: cells.find((c) => /\d+\s*мм/i.test(c)) || "",
          sheetSize: "",
          qtyEstimated: cells.find((c) => /^\d+([.,]\d+)?$/.test(c)) || "",
          unit: "лист",
          source: "xls"
        });
      }
    }
  }

  if (!materials.length && !hardware.length) {
    warnings.push(
      "XLS: не знайдено структурованих матеріалів/фурнітури — потрібна ручна перевірка"
    );
  }

  const extractionQuality =
    materials.length >= 2 && hardware.length >= 1
      ? "good"
      : materials.length || hardware.length
        ? "partial"
        : "poor";

  return { materials, hardware, warnings, extractionQuality };
}

const MAX_XLS_ROWS = 5000;

export async function parseXlsBuffer(buffer, originalName = "") {
  try {
    const mod = await import("xlsx");
    const XLSX = mod.default || mod;
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetRows: MAX_XLS_ROWS });
    const allRows = [];
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      allRows.push(...parseSheetRows(rows));
      if (allRows.length > MAX_XLS_ROWS) {
        return {
          materials: [],
          hardware: [],
          warnings: [
            `XLS занадто великий (${originalName}) — обмеження ${MAX_XLS_ROWS} рядків. Завантажте менший файл або PDF.`
          ],
          extractionQuality: "poor"
        };
      }
    }
    return extractFromRows(allRows);
  } catch (err) {
    return {
      materials: [],
      hardware: [],
      warnings: [
        `XLS не розібрано (${originalName}): ${err.message || "помилка читання"}. Завантажте GLB/PDF для перевірки.`
      ],
      extractionQuality: "poor"
    };
  }
}
