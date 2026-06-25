/** Довідники — спільна логіка для server і client. */

export const CONSTRUCTORS_DIRECTORY_KEY = "Конструктори";

/** Список значень довідника (стійко до різного регістру ключа). */
export function getDirectoryList(directories, key) {
  if (!directories || typeof directories !== "object") return [];
  const direct = directories[key];
  if (Array.isArray(direct) && direct.length) return direct;
  const wanted = String(key || "")
    .trim()
    .toLowerCase();
  for (const [k, value] of Object.entries(directories)) {
    if (String(k).trim().toLowerCase() === wanted && Array.isArray(value)) return value;
  }
  return Array.isArray(direct) ? direct : [];
}
