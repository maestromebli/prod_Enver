/** Метадані файлів ЧПК: тип матеріалу та декор (спільно для server + client). */

export const CNC_MATERIAL_TYPES = ["ЛДСП", "ДСП", "МДФ", "HPL", "фанера", "ДВП", "шпон"];

/** Чи kind файлу пакета дозволяє кілька екземплярів на одну позицію. */
export function isMultiInstancePackageFileKind(kind) {
  return kind === "cnc_file";
}

/**
 * Спроба визначити тип матеріалу та декор з імені файлу ЧПК.
 * Напр. «E30_ДСП_18_W960_SM.kdt» → { materialType: 'ДСП', materialDecor: 'W960' }
 */
export function inferCncFileMaterialMeta(fileName = "") {
  const base = String(fileName).replace(/\.[^.]+$/i, "");
  const upper = base.toUpperCase();

  let materialType = "";
  for (const candidate of [...CNC_MATERIAL_TYPES].sort((a, b) => b.length - a.length)) {
    if (upper.includes(candidate.toUpperCase())) {
      materialType = candidate;
      break;
    }
  }

  const decorMatch =
    base.match(
      /(?:^|[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9])([WUHKF]\d{2,4}[A-Z]{0,4})(?=$|[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9])/i
    ) ||
    base.match(
      /(?:^|[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9])(\d{3,4}\s?[A-Z]{2,4})(?=$|[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9])/i
    );
  const materialDecor = decorMatch ? String(decorMatch[1]).trim().toUpperCase() : "";

  return { materialType, materialDecor };
}

/** Короткий підпис файлу ЧПК для списків UI. */
export function formatCncFileMaterialLabel({ materialType = "", materialDecor = "" } = {}) {
  const type = String(materialType || "").trim();
  const decor = String(materialDecor || "").trim();
  if (type && decor) return `${type} · ${decor}`;
  if (type) return type;
  if (decor) return decor;
  return "";
}

/** Унікальні типи та декори з набору файлів пакета. */
export function summarizeCncPackageFiles(files = []) {
  const cnc = (files || []).filter((f) => f.kind === "cnc_file");
  const types = [...new Set(cnc.map((f) => String(f.materialType || "").trim()).filter(Boolean))];
  const decors = [...new Set(cnc.map((f) => String(f.materialDecor || "").trim()).filter(Boolean))];
  return { count: cnc.length, types, decors, files: cnc };
}
