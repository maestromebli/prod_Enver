import { all, one, run } from "./db.js";
import {
  DEFAULT_MATERIAL_LIBRARY_SEED,
  mapMaterialLibraryRow,
  normalizeMaterialLibraryInput
} from "../../shared/production/material-library.js";

function mapRow(row) {
  return mapMaterialLibraryRow(row);
}

export async function listMaterialLibrary({
  search = "",
  itemType = "",
  activeOnly = true,
  limit = 200
} = {}) {
  const params = [];
  let where = "WHERE 1=1";

  if (activeOnly) {
    where += " AND active = TRUE";
  }
  if (itemType) {
    params.push(itemType);
    where += ` AND item_type = $${params.length}`;
  }
  const q = String(search || "").trim();
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where += ` AND (
      lower(name) LIKE ${p}
      OR lower(article) LIKE ${p}
      OR lower(material) LIKE ${p}
      OR lower(supplier) LIKE ${p}
      OR lower(decor) LIKE ${p}
    )`;
  }

  params.push(Math.min(Number(limit) || 200, 500));
  const rows = await all(
    `SELECT * FROM material_library_items
     ${where}
     ORDER BY name ASC, id ASC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(mapRow);
}

export async function getMaterialLibraryItem(id) {
  const row = await one(`SELECT * FROM material_library_items WHERE id = $1`, [id]);
  return mapRow(row);
}

export async function createMaterialLibraryItem(body) {
  const parsed = normalizeMaterialLibraryInput(body);
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }
  const r = parsed.row;
  const row = await one(
    `INSERT INTO material_library_items
       (name, article, item_type, category, material, thickness, decor, unit, supplier, estimated_price, notes, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      r.name,
      r.article,
      r.item_type,
      r.category,
      r.material,
      r.thickness,
      r.decor,
      r.unit,
      r.supplier,
      r.estimated_price,
      r.notes,
      r.active
    ]
  );
  return mapRow(row);
}

export async function updateMaterialLibraryItem(id, body) {
  const existing = await one(`SELECT * FROM material_library_items WHERE id = $1`, [id]);
  if (!existing) {
    const err = new Error("Матеріал не знайдено");
    err.status = 404;
    throw err;
  }
  const parsed = normalizeMaterialLibraryInput({ ...mapRow(existing), ...body });
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }
  const r = parsed.row;
  const row = await one(
    `UPDATE material_library_items SET
       name = $1,
       article = $2,
       item_type = $3,
       category = $4,
       material = $5,
       thickness = $6,
       decor = $7,
       unit = $8,
       supplier = $9,
       estimated_price = $10,
       notes = $11,
       active = $12,
       updated_at = now()
     WHERE id = $13
     RETURNING *`,
    [
      r.name,
      r.article,
      r.item_type,
      r.category,
      r.material,
      r.thickness,
      r.decor,
      r.unit,
      r.supplier,
      r.estimated_price,
      r.notes,
      body.active !== undefined ? body.active !== false : existing.active,
      id
    ]
  );
  return mapRow(row);
}

export async function deactivateMaterialLibraryItem(id) {
  const row = await one(
    `UPDATE material_library_items SET active = FALSE, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!row) {
    const err = new Error("Матеріал не знайдено");
    err.status = 404;
    throw err;
  }
  return mapRow(row);
}

export async function seedMaterialLibraryIfEmpty() {
  const count = await one(`SELECT COUNT(*)::int AS n FROM material_library_items`);
  if (Number(count?.n) > 0) return { seeded: false, count: count.n };

  for (const item of DEFAULT_MATERIAL_LIBRARY_SEED) {
    const parsed = normalizeMaterialLibraryInput(item);
    if (!parsed.ok) continue;
    const r = parsed.row;
    await run(
      `INSERT INTO material_library_items
         (name, article, item_type, category, material, thickness, decor, unit, supplier, estimated_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`,
      [
        r.name,
        r.article,
        r.item_type,
        r.category,
        r.material,
        r.thickness,
        r.decor,
        r.unit,
        r.supplier
      ]
    );
  }
  const after = await one(`SELECT COUNT(*)::int AS n FROM material_library_items`);
  return { seeded: true, count: after?.n || 0 };
}
