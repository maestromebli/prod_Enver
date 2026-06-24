/** Проста текстова схожість без vector DB. */

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1);
}

export function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

export function itemNameSimilarity(a, b) {
  const na = String(a || "")
    .trim()
    .toLowerCase();
  const nb = String(b || "")
    .trim()
    .toLowerCase();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return jaccardSimilarity(na, nb);
}

export function fieldMatchScore(value, candidate) {
  const a = String(value || "")
    .trim()
    .toLowerCase();
  const b = String(candidate || "")
    .trim()
    .toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.7;
  return jaccardSimilarity(a, b);
}

export function combinedSimilarity({ itemName, itemType, material }, event) {
  const nameScore = itemNameSimilarity(itemName, event.item_name) * 0.5;
  const typeScore = fieldMatchScore(itemType, event.item_type) * 0.25;
  const matScore = fieldMatchScore(material, event.material) * 0.25;
  return nameScore + typeScore + matScore;
}
