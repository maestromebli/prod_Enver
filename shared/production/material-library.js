/** Бібліотека матеріалів — спільні типи та валідація (server + client). */

import { PROCUREMENT_ITEM_TYPES } from "./constructive-package.js";
import { MTO_CATEGORIES, mtoCategoryLabel } from "./procurement.js";

export const MATERIAL_LIBRARY_ITEM_TYPES = [...PROCUREMENT_ITEM_TYPES];

export const MATERIAL_ITEM_TYPE_LABELS = {
  board: "Листовий матеріал",
  edge: "Крайка",
  hardware: "Фурнітура",
  accessory: "Комплектуюче",
  service: "Послуга",
  other: "Інше"
};

export function materialItemTypeLabel(type) {
  return MATERIAL_ITEM_TYPE_LABELS[type] || type || "—";
}

export const DEFAULT_MATERIAL_LIBRARY_SEED = [
  {
    name: "ДСП 18 мм білий",
    article: "DSP-18-W",
    itemType: "board",
    material: "ДСП",
    thickness: "18",
    decor: "Білий",
    unit: "лист",
    supplier: "Віяр"
  },
  {
    name: "ДСП 18 мм дуб натуральний",
    article: "DSP-18-OAK",
    itemType: "board",
    material: "ДСП",
    thickness: "18",
    decor: "Дуб",
    unit: "лист",
    supplier: "Віяр"
  },
  {
    name: "МДФ 16 мм фарбований",
    article: "MDF-16",
    itemType: "board",
    material: "МДФ",
    thickness: "16",
    unit: "лист",
    supplier: ""
  },
  {
    name: "Крайка ПВХ 22×0,4 біла",
    article: "EDGE-22-04-W",
    itemType: "edge",
    material: "ПВХ",
    thickness: "0.4",
    decor: "Білий",
    unit: "м.п.",
    supplier: "Rehau"
  },
  {
    name: "Крайка ПВХ 22×2 дуб",
    article: "EDGE-22-2-OAK",
    itemType: "edge",
    material: "ПВХ",
    thickness: "2",
    decor: "Дуб",
    unit: "м.п.",
    supplier: "Rehau"
  },
  {
    name: "Петля Blum Clip Top 110°",
    article: "71B3550",
    itemType: "hardware",
    unit: "шт",
    supplier: "Blum"
  },
  {
    name: "Направляюча Tandem 450 мм",
    article: "BLUM-TANDEM-450",
    itemType: "hardware",
    unit: "компл",
    supplier: "Blum"
  },
  {
    name: "Фасад AGT Soft Touch",
    article: "",
    itemType: "accessory",
    category: "facade_agt",
    unit: "м²",
    supplier: "AGT"
  },
  {
    name: "Дзеркало срібло 4 мм",
    article: "",
    itemType: "accessory",
    category: "mirror",
    unit: "м²",
    supplier: ""
  },
  {
    name: "Розсувна система Hettich TopLine L",
    article: "TOPLINE-L",
    itemType: "accessory",
    category: "sliding_system",
    unit: "компл",
    supplier: "Hettich"
  }
];

export function normalizeMaterialLibraryInput(body = {}) {
  const name = String(body.name ?? "").trim();
  const itemType = String(body.itemType ?? body.item_type ?? "other").trim() || "other";
  const category = String(body.category ?? "").trim();
  if (!name) {
    return { ok: false, error: "Вкажіть назву матеріалу" };
  }
  if (!MATERIAL_LIBRARY_ITEM_TYPES.includes(itemType)) {
    return { ok: false, error: `Невідомий тип: ${itemType}` };
  }
  if (category && !MTO_CATEGORIES.includes(category)) {
    return { ok: false, error: `Невідома категорія MTO: ${category}` };
  }
  return {
    ok: true,
    row: {
      name,
      article: String(body.article ?? "").trim(),
      item_type: itemType,
      category,
      material: String(body.material ?? "").trim(),
      thickness: String(body.thickness ?? "").trim(),
      decor: String(body.decor ?? "").trim(),
      unit: String(body.unit ?? "шт").trim() || "шт",
      supplier: String(body.supplier ?? "").trim(),
      estimated_price: Number(body.estimatedPrice ?? body.estimated_price) || 0,
      notes: String(body.notes ?? "").trim(),
      active: body.active !== false
    }
  };
}

export function mapMaterialLibraryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    article: row.article || "",
    itemType: row.item_type || "other",
    category: row.category || "",
    categoryLabel: row.category ? mtoCategoryLabel(row.category) : "",
    material: row.material || "",
    thickness: row.thickness || "",
    decor: row.decor || "",
    unit: row.unit || "шт",
    supplier: row.supplier || "",
    estimatedPrice: Number(row.estimated_price) || 0,
    notes: row.notes || "",
    active: row.active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Поля для автозаповнення MTO / рядка закупівлі. */
export function procurementFieldsFromLibraryItem(item) {
  if (!item) return null;
  return {
    name: item.name,
    article: item.article || "",
    category: item.category || "custom",
    unit: item.unit || "шт",
    supplier: item.supplier || "",
    materialLibraryId: item.id
  };
}
