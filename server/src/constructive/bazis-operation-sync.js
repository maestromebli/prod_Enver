import fs from "fs";
import { all, run } from "../db.js";
import { resolveStoredPath } from "../file-storage.js";
import { decodeProjectText } from "./parsers/project-text.js";
import {
  extractBazisOperationCodesFromProjectText,
  groupBazisOperationCodesByPartNo
} from "../../../shared/production/bazis-operation-code.js";

export async function readProjectTextsForPackage(packageId) {
  const files = await all(
    `SELECT storage_path, original_name FROM constructive_package_files
     WHERE package_id = $1 AND kind = 'project'`,
    [packageId]
  );
  const texts = [];
  for (const f of files) {
    const fullPath = resolveStoredPath(f.storage_path);
    if (!fs.existsSync(fullPath)) continue;
    try {
      texts.push(decodeProjectText(fs.readFileSync(fullPath)));
    } catch {
      /* ignore */
    }
  }
  return texts;
}

/** Зберігає коди операцій Bazis у constructive_parts / instances. */
export async function syncBazisOperationCodesForPackage(packageId) {
  const texts = await readProjectTextsForPackage(packageId);
  if (!texts.length) return { updated: 0 };

  const codes = [...new Set(texts.flatMap((t) => extractBazisOperationCodesFromProjectText(t)))];
  const byPartNo = groupBazisOperationCodesByPartNo(codes);
  if (!byPartNo.size) return { updated: 0 };

  const parts = await all(
    `SELECT id, part_no, qty, bazis_operation_codes, model_mesh_name, model_node_id
     FROM constructive_parts WHERE package_id = $1`,
    [packageId]
  );

  let updated = 0;
  for (const part of parts) {
    const partNo = String(part.part_no || "").trim();
    const opCodes = byPartNo.get(partNo) || byPartNo.get(String(Number(partNo))) || [];
    if (!opCodes.length) continue;

    const existing = Array.isArray(part.bazis_operation_codes) ? part.bazis_operation_codes : [];
    const merged = [...new Set([...existing, ...opCodes])];
    const changed = merged.length !== existing.length || merged.some((c, i) => c !== existing[i]);

    const needsMesh = !part.model_mesh_name && !part.model_node_id && partNo;
    if (!changed && !needsMesh) continue;

    await run(
      `UPDATE constructive_parts
       SET bazis_operation_codes = $1,
           model_mesh_name = CASE WHEN model_mesh_name = '' AND $3 <> '' THEN $3 ELSE model_mesh_name END,
           model_node_id = CASE WHEN model_node_id = '' AND $3 <> '' THEN $3 ELSE model_node_id END,
           updated_at = now()
       WHERE id = $2`,
      [merged, part.id, partNo]
    );
    updated += 1;

    const instances = await all(
      `SELECT id, instance_no, bazis_operation_code FROM constructive_part_instances
       WHERE part_id = $1 ORDER BY instance_no`,
      [part.id]
    );
    for (let i = 0; i < instances.length; i += 1) {
      const code = opCodes[i] || opCodes[0] || "";
      if (!code || instances[i].bazis_operation_code === code) continue;
      await run(`UPDATE constructive_part_instances SET bazis_operation_code = $1 WHERE id = $2`, [
        code,
        instances[i].id
      ]);
    }
  }

  return { updated };
}
