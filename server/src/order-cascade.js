import fs from "fs";
import { all, one, run } from "./db.js";
import { logOrderDelete, logPositionDelete } from "./audit.js";
import { resolveStoredPath } from "./file-storage.js";

/** Усі id позицій замовлення (за order_id або legacy order_number). */
export async function collectOrderPositionIds(orderId, orderNumber) {
  const rows = await all(
    `SELECT id FROM positions
     WHERE order_id = $1 OR ($2 <> '' AND order_number = $2)`,
    [orderId, orderNumber || ""]
  );
  return rows.map((r) => r.id);
}

/** Блокує видалення, якщо хтось із операторів працює над позицією. */
export async function assertNoActiveOperatorSessions(positionIds) {
  if (!positionIds.length) return;
  const row = await one(
    `SELECT COUNT(*)::int AS cnt FROM operator_sessions
     WHERE position_id = ANY($1::int[]) AND finished_at IS NULL`,
    [positionIds]
  );
  if (Number(row?.cnt) > 0) {
    const err = new Error("Неможливо видалити — оператор працює над позицією замовлення.");
    err.status = 409;
    throw err;
  }
}

async function collectStoragePaths(positionIds) {
  if (!positionIds.length) return [];
  const fromPositionFiles = await all(
    `SELECT storage_path FROM position_files WHERE position_id = ANY($1::int[])`,
    [positionIds]
  );
  const fromPackageFiles = await all(
    `SELECT cpf.storage_path
     FROM constructive_package_files cpf
     JOIN constructive_packages cp ON cp.id = cpf.package_id
     WHERE cp.position_id = ANY($1::int[])`,
    [positionIds]
  );
  const fromWorkspace = await all(
    `SELECT storage_path FROM constructor_workspace_files WHERE position_id = ANY($1::int[])`,
    [positionIds]
  );
  return [...fromPositionFiles, ...fromPackageFiles, ...fromWorkspace]
    .map((r) => r.storage_path)
    .filter((p) => p && String(p).trim());
}

function unlinkStoredFiles(storagePaths) {
  const seen = new Set();
  for (const storagePath of storagePaths) {
    if (seen.has(storagePath)) continue;
    seen.add(storagePath);
    try {
      const full = resolveStoredPath(storagePath);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      /* ignore missing or locked files */
    }
  }
}

/** Синхронізує поля замовлення на всі пов’язані позиції після редагування. */
export async function syncPositionsFromOrder(existing, updated) {
  const orderId = updated.id;
  const orderNumber = updated.order_number || "";
  const oldOrderNumber = existing.order_number || "";
  const object = updated.object || "";
  const manager = updated.manager || "";
  const deliveryAddress = updated.default_delivery_address || "";
  const numbers = [...new Set([orderNumber, oldOrderNumber].filter(Boolean))];

  await run(
    `UPDATE positions SET
      order_number = $2,
      object = $3,
      manager = $4,
      delivery_address = CASE
        WHEN $5 <> '' THEN $5
        ELSE delivery_address
      END
     WHERE order_id = $1 OR order_number = ANY($6::text[])`,
    [orderId, orderNumber, object, manager, deliveryAddress, numbers]
  );

  const oldObject = String(existing.object || "").trim();
  if (object && object !== oldObject) {
    await run(
      `UPDATE positions SET item = $3
       WHERE parent_id IS NULL
         AND (order_id = $1 OR order_number = ANY($2::text[]))
         AND (item = $4 OR item_type = 'Замовлення')`,
      [orderId, numbers, object, oldObject]
    );
  }
}

/**
 * Повне видалення замовлення з усіма позиціями та файлами.
 * @param {object} tx — клієнт транзакції з db.withTransaction
 */
export async function deleteOrderWithPositions(orderRow, actor, tx) {
  const orderId = orderRow.id;
  const orderNumber = orderRow.order_number;
  const positionIds = await collectOrderPositionIds(orderId, orderNumber);
  await assertNoActiveOperatorSessions(positionIds);

  const storagePaths = await collectStoragePaths(positionIds);

  for (const positionId of positionIds) {
    const posRow = await tx.one("SELECT * FROM positions WHERE id = $1", [positionId]);
    if (posRow) await logPositionDelete(posRow, actor);
  }

  if (positionIds.length) {
    await tx.run("DELETE FROM positions WHERE id = ANY($1::int[])", [positionIds]);
  }

  await logOrderDelete(orderRow, actor);
  await tx.run("DELETE FROM orders WHERE id = $1", [orderId]);

  unlinkStoredFiles(storagePaths);
}
