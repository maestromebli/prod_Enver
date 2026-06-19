export function parseJson(str, fallback = null) {
  try {
    return JSON.parse(str || "");
  } catch {
    return fallback;
  }
}

export function parseJsonObject(str) {
  return parseJson(str, {});
}
