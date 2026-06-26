/** Декодування тексту .project (BM / Базис) з windows-1251. */

export function decodeProjectText(buffer) {
  const slice = buffer.subarray(0, Math.min(buffer.length, 8_000_000));
  const head = slice.toString("utf8", 0, Math.min(slice.length, 200));
  const encoding = head.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";

  if (encoding.includes("1251") || encoding.includes("windows-1251")) {
    try {
      return new TextDecoder("windows-1251").decode(slice);
    } catch {
      /* fallback */
    }
  }

  const utf8 = slice.toString("utf8");
  if (utf8.includes("<?xml") || utf8.includes("<")) return utf8;
  return slice.toString("utf16le");
}

export function pickXmlAttr(attrs, names) {
  for (const n of names) {
    const escaped = String(n).replace(/\./g, "\\.");
    const am = attrs.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "i"));
    if (am) return am[1].trim();
  }
  return "";
}

/** Товщина деталі з вкладених program у <operation> (dz у мм). */
export function buildOperationThicknessMap(text) {
  const map = new Map();
  const re = /<operation([^>]*)>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1] || "";
    const code = pickXmlAttr(attrs, ["code"]);
    const program = pickXmlAttr(attrs, ["program"]);
    if (!code || !program) continue;
    const decoded = program
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&#x2F;/gi, "/");
    const dz = decoded.match(/\bdz\s*=\s*["']([\d.]+)/i)?.[1];
    if (!dz) continue;
    const partKey = code.split("x")[0]?.replace(/^0+/, "") || "";
    if (partKey && !map.has(partKey)) map.set(partKey, dz);
  }
  return map;
}
