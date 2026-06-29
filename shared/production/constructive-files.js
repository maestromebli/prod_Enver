/** Ліміт розміру одного файлу конструктива (байти). */
export const CONSTRUCTIVE_MAX_BYTES = 500 * 1024 * 1024;

/** Дозволені розширення конструктивів. */
export const CONSTRUCTIVE_ACCEPT_EXT = [
  ".pdf",
  ".zip",
  ".xml",
  ".txt",
  ".json",
  ".dwg",
  ".dxf",
  ".xls",
  ".xlsx",
  ".project",
  ".b3d"
];

export function constructiveExtension(fileName) {
  const n = String(fileName || "");
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i).toLowerCase() : "";
}

export function isConstructiveExtension(fileName) {
  const ext = constructiveExtension(fileName);
  return ext && CONSTRUCTIVE_ACCEPT_EXT.includes(ext);
}

export function formatConstructiveSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

/** Підпис для списку замовлень: «3 файли» або ім'я одного файлу. */
export function constructiveFilesSummary({ fileCount, latestName }) {
  const count = Number(fileCount) || 0;
  if (count <= 0) return "";
  if (count === 1) return String(latestName || "файл");
  return `${count} файли`;
}
