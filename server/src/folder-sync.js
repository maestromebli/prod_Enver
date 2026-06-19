import { all, one, run } from "./db.js";
import { mapPosition } from "./mappers.js";
import { enrichPositionRow } from "./position-logic.js";
import { nextPositionId } from "./db/position-id.js";
import { mergeGiblabSummary } from "./giblab-parser.js";
import { orderStatusStagePreset, applyOrderStatusPreset } from "./order-status-workflow.js";

const FOLDER_STATES = new Set(["inbox", "active", "done", "archive"]);

export function normalizeFolderKey(key) {
  return String(key || "")
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-");
}


function parseJson(str, fallback) {
  try {
    return JSON.parse(str || "");
  } catch {
    return fallback;
  }
}

export function mapMachineProgress(raw) {
  const data = typeof raw === "string" ? parseJson(raw, {}) : raw || {};
  return {
    percent: Number(data.percent) || 0,
    piecesDone: Number(data.piecesDone) || 0,
    piecesTotal: Number(data.piecesTotal) || 0,
    cutLengthMm: Number(data.cutLengthMm) || 0,
    cutLengthM: data.cutLengthMm ? Math.round((data.cutLengthMm / 1000) * 10) / 10 : 0,
    lastLogAt: data.lastLogAt || null,
    jobRef: data.jobRef || ""
  };
}

export async function logFolderSync(folderKey, action, payload = {}) {
  await run(`INSERT INTO folder_sync_log (folder_key, action, payload_json) VALUES ($1, $2, $3)`, [
    folderKey,
    action,
    JSON.stringify(payload)
  ]);
}

export async function enqueueFolderCommand({
  commandType = "move",
  folderKey,
  positionId,
  fromState,
  toState,
  payload = {}
}) {
  if (!folderKey) return null;
  const existing = await one(
    `SELECT id FROM folder_commands
     WHERE folder_key = $1 AND from_state = $2 AND to_state = $3 AND status = 'pending'
     LIMIT 1`,
    [folderKey, fromState, toState]
  );
  if (existing) return existing.id;

  const row = await one(
    `INSERT INTO folder_commands (
      command_type, folder_key, position_id, from_state, to_state, payload_json
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [commandType, folderKey, positionId ?? null, fromState, toState, JSON.stringify(payload)]
  );
  return row.id;
}

export async function getPendingCommands(limit = 20) {
  return all(
    `SELECT * FROM folder_commands
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
}

export async function ackFolderCommand(commandId, { ok = true, error = "" } = {}) {
  await run(
    `UPDATE folder_commands SET
      status = $1,
      error_message = $2,
      completed_at = now()
     WHERE id = $3`,
    [ok ? "done" : "failed", error, commandId]
  );
}

export async function updatePositionFolderState(positionId, folderState) {
  if (!FOLDER_STATES.has(folderState)) return;
  await run(`UPDATE positions SET folder_state = $1 WHERE id = $2`, [folderState, positionId]);
}

export async function recordAgentHeartbeat(agentId, version, rootPath, payload = {}) {
  await run(
    `INSERT INTO folder_agent_heartbeats (agent_id, version, root_path, payload_json)
     VALUES ($1, $2, $3, $4)`,
    [agentId, version, rootPath, JSON.stringify(payload)]
  );
}

async function upsertOrderFromMeta(meta) {
  const orderNumber = String(meta.orderNumber || "").trim();
  if (!orderNumber) throw new Error("meta.orderNumber обов'язковий");

  let order = await one("SELECT * FROM orders WHERE order_number = $1", [orderNumber]);
  if (!order) {
    order = await one(
      `INSERT INTO orders (
        order_number, object, client, manager, status, priority, comment
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        orderNumber,
        meta.object || "",
        meta.client || "",
        meta.manager || "",
        "У виробництві",
        meta.priority || "Середній",
        meta.comment || "Імпорт з папки цеху"
      ]
    );
  } else {
    await run(`UPDATE orders SET object = $1, client = $2, updated_at = now() WHERE id = $3`, [
      meta.object || order.object,
      meta.client || order.client,
      order.id
    ]);
    order = await one("SELECT * FROM orders WHERE id = $1", [order.id]);
  }
  return order;
}

async function upsertPositionFromFolder({
  folderKey,
  folderPath,
  folderState,
  meta,
  files = [],
  giblabSummary = {}
}) {
  const order = await upsertOrderFromMeta(meta);
  const merged = mergeGiblabSummary(meta, giblabSummary, giblabSummary);
  const itemName =
    (Array.isArray(meta.items) && meta.items[0]?.name) || meta.item || order.object || folderKey;

  let position = await one("SELECT * FROM positions WHERE folder_key = $1 LIMIT 1", [folderKey]);

  const preset = orderStatusStagePreset(order.status);
  let base = position
    ? { ...position }
    : {
        id: await nextPositionId(),
        parent_id: null,
        order_id: order.id,
        order_number: order.order_number,
        object: order.object,
        item: itemName,
        item_type: "Виріб",
        manager: order.manager,
        constructor_name: "",
        cutting_status: "Не розпочато",
        edging_status: "Не розпочато",
        drilling_status: "Не розпочато",
        assembly_status: "Не розпочато",
        assembly_responsible: "",
        ready_date: "",
        install_date: "",
        install_end_date: "",
        install_time_start: "",
        install_time_end: "",
        install_responsible: "",
        position_status: "Не розпочато",
        progress: 0,
        overdue_days: 0,
        problem: "",
        note: ""
      };

  base = applyOrderStatusPreset(base, preset);

  if (folderState === "inbox" && !position) {
    base.cutting_status = "Передано";
    base.position_status = "У виробництві";
  }
  if (folderState === "active" && ["Передано", "Не розпочато"].includes(base.cutting_status)) {
    base.cutting_status = "В роботі";
  }
  if (folderState === "done" && base.cutting_status === "В роботі") {
    base.cutting_status = "Готово";
    if (!base.edging_status || base.edging_status === "Не розпочато") {
      base.edging_status = "Передано";
    }
  }

  const enriched = enrichPositionRow({
    ...base,
    folder_key: folderKey,
    folder_path: folderPath || "",
    folder_state: folderState,
    folder_meta_json: JSON.stringify(meta),
    folder_files_json: JSON.stringify(files),
    material: merged.material || meta.material || "",
    giblab_summary_json: JSON.stringify(merged)
  });

  if (position) {
    await run(
      `UPDATE positions SET
        order_id = @order_id,
        order_number = @order_number,
        object = @object,
        item = @item,
        cutting_status = @cutting_status,
        edging_status = @edging_status,
        drilling_status = @drilling_status,
        assembly_status = @assembly_status,
        position_status = @position_status,
        progress = @progress,
        folder_key = @folder_key,
        folder_path = @folder_path,
        folder_state = @folder_state,
        folder_meta_json = @folder_meta_json,
        folder_files_json = @folder_files_json,
        material = @material,
        giblab_summary_json = @giblab_summary_json
      WHERE id = @id`,
      { ...enriched, id: position.id }
    );
    position = await one("SELECT * FROM positions WHERE id = $1", [position.id]);
  } else {
    await run(
      `INSERT INTO positions (
        id, parent_id, order_id, order_number, object, item, item_type, manager,
        constructor_name, cutting_status, edging_status, drilling_status, assembly_status,
        assembly_responsible, ready_date, install_date, install_end_date,
        install_time_start, install_time_end, install_responsible,
        position_status, progress, overdue_days, problem, note,
        folder_key, folder_path, folder_state, folder_meta_json, folder_files_json,
        material, giblab_summary_json
      ) VALUES (
        @id, @parent_id, @order_id, @order_number, @object, @item, @item_type, @manager,
        @constructor_name, @cutting_status, @edging_status, @drilling_status, @assembly_status,
        @assembly_responsible, @ready_date, @install_date, @install_end_date,
        @install_time_start, @install_time_end, @install_responsible,
        @position_status, @progress, @overdue_days, @problem, @note,
        @folder_key, @folder_path, @folder_state, @folder_meta_json, @folder_files_json,
        @material, @giblab_summary_json
      )`,
      enriched
    );
    position = await one("SELECT * FROM positions WHERE id = $1", [enriched.id]);
  }

  return mapPosition(enrichPositionRow(position));
}

/** Масовий sync від файлового агента. */
export async function syncFoldersFromAgent(folders = []) {
  const results = [];
  for (const entry of folders) {
    const folderKey = normalizeFolderKey(entry.folderKey || entry.meta?.orderNumber);
    if (!folderKey) continue;

    const folderState = FOLDER_STATES.has(entry.state) ? entry.state : "inbox";
    const meta = entry.meta || { orderNumber: folderKey };
    if (!meta.orderNumber) meta.orderNumber = folderKey;

    const position = await upsertPositionFromFolder({
      folderKey,
      folderPath: entry.folderPath || "",
      folderState,
      meta,
      files: entry.files || [],
      giblabSummary: entry.giblabSummary || {}
    });

    await logFolderSync(folderKey, "synced", { folderState, positionId: position.id });
    results.push({
      folderKey,
      folderState,
      positionId: position.id,
      orderNumber: position.orderNumber
    });
  }
  return results;
}

export async function getOperatorJobDetails(positionId) {
  const row = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!row) return null;

  const meta = parseJson(row.folder_meta_json, {});
  const files = parseJson(row.folder_files_json, []);
  const giblab = parseJson(row.giblab_summary_json, {});
  const machine = mapMachineProgress(row.machine_progress_json);

  return {
    position: mapPosition(enrichPositionRow(row)),
    orderNumber: row.order_number,
    object: row.object,
    client: meta.client || "",
    material: row.material || meta.material || giblab.material || "",
    folderKey: row.folder_key,
    folderPath: row.folder_path,
    folderState: row.folder_state,
    meta,
    files,
    giblabSummary: giblab,
    machineProgress: machine,
    kdtJobs: (meta.items || []).map((item) => ({
      name: item.name || item.id,
      kdtFolder: item.kdtFolder || ""
    }))
  };
}

export async function onOperatorStartFolder(positionId) {
  const row = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!row?.folder_key) return null;

  const from = row.folder_state || "inbox";
  await updatePositionFolderState(positionId, "active");
  return enqueueFolderCommand({
    folderKey: row.folder_key,
    positionId,
    fromState: from === "inbox" ? "inbox" : from,
    toState: "active",
    payload: { trigger: "operator_start" }
  });
}

export async function onOperatorFinishCutting(positionId) {
  const row = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!row?.folder_key) return null;

  await updatePositionFolderState(positionId, "done");
  return enqueueFolderCommand({
    folderKey: row.folder_key,
    positionId,
    fromState: "active",
    toState: "done",
    payload: { trigger: "operator_finish_cutting" }
  });
}

export async function archiveFolderForOrder(orderId) {
  const positions = await all("SELECT * FROM positions WHERE order_id = $1", [orderId]);
  const commandIds = [];
  for (const row of positions) {
    if (!row.folder_key) continue;
    await updatePositionFolderState(row.id, "archive");
    const id = await enqueueFolderCommand({
      commandType: "archive",
      folderKey: row.folder_key,
      positionId: row.id,
      fromState: row.folder_state || "done",
      toState: "archive",
      payload: { trigger: "order_archived" }
    });
    if (id) commandIds.push(id);
  }
  return commandIds;
}

export async function updatePositionMachineProgress(positionId, patch) {
  const row = await one("SELECT machine_progress_json FROM positions WHERE id = $1", [positionId]);
  if (!row) return;
  const current = parseJson(row.machine_progress_json, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await run(`UPDATE positions SET machine_progress_json = $1 WHERE id = $2`, [
    JSON.stringify(next),
    positionId
  ]);
}

export async function recordCuttingStat({
  positionId,
  orderNumber,
  material,
  piecesTotal,
  cutLengthMm,
  giblabHash,
  startedAt,
  finishedAt,
  durationSec,
  machineProfile = "kdt"
}) {
  await run(
    `INSERT INTO cutting_stats (
      position_id, order_number, material, pieces_total, cut_length_mm,
      giblab_hash, started_at, finished_at, duration_sec, machine_profile
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      positionId,
      orderNumber || "",
      material || "",
      piecesTotal || 0,
      cutLengthMm || 0,
      giblabHash || "",
      startedAt,
      finishedAt,
      durationSec || 0,
      machineProfile
    ]
  );
}

export async function getCuttingHistory(material = "", limit = 50) {
  if (material) {
    return all(
      `SELECT * FROM cutting_stats
       WHERE lower(material) LIKE $1
       ORDER BY finished_at DESC NULLS LAST
       LIMIT $2`,
      [`%${material.toLowerCase()}%`, limit]
    );
  }
  return all(`SELECT * FROM cutting_stats ORDER BY finished_at DESC NULLS LAST LIMIT $1`, [limit]);
}

export function folderStateLabel(state) {
  const map = {
    inbox: "Очікує",
    active: "В роботі (папка)",
    done: "Порізано",
    archive: "Архів"
  };
  return map[state] || state || "—";
}
