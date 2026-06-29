import { buildPartCadGeometry } from "../../../shared/production/bazis-operation-geometry.js";
import { readProjectTextsForPackage } from "./bazis-operation-sync.js";

const textCache = new Map();

async function projectTextsForPackage(packageId) {
  const key = String(packageId);
  if (textCache.has(key)) return textCache.get(key);
  const texts = await readProjectTextsForPackage(packageId);
  textCache.set(key, texts);
  return texts;
}

/** CAD-геометрія деталі з .project пакета (координати отворів, кромка). */
export async function getPartCadGeometry(packageId, part) {
  if (!packageId || !part) return null;
  const texts = await projectTextsForPackage(packageId);
  if (!texts.length) return null;
  return buildPartCadGeometry({ projectTexts: texts, part });
}

export function clearPartCadGeometryCache(packageId = null) {
  if (packageId == null) {
    textCache.clear();
    return;
  }
  textCache.delete(String(packageId));
}
