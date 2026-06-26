/** Конструктори для призначення: довідник + збіг з користувачами (server + client). */

export function normalizePersonName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

/** Усі імена з довідника; id — якщо є активний користувач з таким ім'ям. */
export function buildConstructorAssigneesFromDirectory(directoryNames = [], users = []) {
  const usersByName = new Map();
  for (const user of users) {
    const key = normalizePersonName(user.name);
    if (key && !usersByName.has(key)) usersByName.set(key, user);
  }

  const result = [];
  const seen = new Set();
  for (const rawName of directoryNames) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const key = normalizePersonName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const user = usersByName.get(key);
    result.push(
      user
        ? { id: user.id, name: user.name, login: user.login ?? null, role: user.role ?? null }
        : { id: null, name, login: null, role: null }
    );
  }
  return result;
}

/** Об'єднати відповідь API з локальним довідником (якщо API порожній або застарів). */
export function mergeConstructorAssignees(apiList = [], directoryNames = []) {
  const fromApi = Array.isArray(apiList) ? apiList : [];
  if (!directoryNames?.length) return fromApi;
  const merged = buildConstructorAssigneesFromDirectory(directoryNames, fromApi);
  for (const entry of fromApi) {
    if (entry?.id == null || !entry.name) continue;
    const key = normalizePersonName(entry.name);
    if (!merged.some((m) => normalizePersonName(m.name) === key)) {
      merged.push(entry);
    }
  }
  return merged;
}

export function parseConstructorAssigneeValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return { constructorUserId: null, constructorName: "" };
  if (raw.startsWith("u:")) {
    const id = Number(raw.slice(2));
    return Number.isFinite(id)
      ? { constructorUserId: id, constructorName: "" }
      : { constructorUserId: null, constructorName: "" };
  }
  if (raw.startsWith("n:")) {
    return { constructorUserId: null, constructorName: raw.slice(2).trim() };
  }
  const legacyId = Number(raw);
  if (Number.isFinite(legacyId) && legacyId > 0) {
    return { constructorUserId: legacyId, constructorName: "" };
  }
  return { constructorUserId: null, constructorName: raw };
}
