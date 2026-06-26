import { all, one, run } from "./db.js";
import { saveConstructiveFile } from "./file-storage.js";
import {
  parseWorkspaceJson,
  suggestConstructorTiming,
  validateWorkspacePayload,
  workspaceCompletion
} from "./constructor-desk-service.js";
import {
  repairConstructorDeskQueue,
  syncOrderStatusAfterConstructorAssignment
} from "./constructor-desk-queue.js";
import {
  getDirectories,
  CONSTRUCTORS_DIRECTORY_KEY,
  getDirectoryList
} from "./directories-store.js";
import { getWorkPositions } from "../../shared/production/order-position-model.js";
import {
  getPositionManagerBundle,
  getManagerFileForDownload,
  listManagerFiles,
  saveManagerData,
  uploadManagerFile
} from "./position-manager-service.js";
import {
  defaultManagerDataJson,
  isManagerDataComplete,
  buildManagerDataFromRow,
  getPositionRequirements
} from "../../shared/production/position-manager-data.js";
import {
  isWorkspaceManagerKind,
  managerKindToWorkspaceKind,
  workspaceKindToManagerKind
} from "../../shared/production/manager-file-adapter.js";
import {
  buildConstructorAssigneesFromDirectory,
  normalizePersonName,
  parseConstructorAssigneeValue
} from "../../shared/production/constructor-assignees.js";

export {
  normalizePersonName,
  buildConstructorAssigneesFromDirectory,
  parseConstructorAssigneeValue
};

/** Активні користувачі, чиє ім'я є в довіднику «Конструктори». */
export function filterUsersByConstructorDirectory(users, directoryNames = []) {
  const allowed = new Set(directoryNames.map(normalizePersonName).filter(Boolean));
  return users.filter((user) => allowed.has(normalizePersonName(user.name)));
}

const POSITION_SELECT = `
  p.id, p.parent_id, p.order_id, p.order_number, p.object, p.item, p.item_type,
  p.manager, p.constructor_name, p.has_constructive_file, p.current_stage,
  p.position_status, p.progress, p.ready_date,
  p.constructor_user_id, p.constructor_assigned_at, p.constructor_due_at,
  p.constructor_estimated_hours, p.constructor_workspace_json, p.constructor_desk_queued_at,
  p.manager_data_json,
  u.name AS constructor_user_name,
  o.client AS order_client, o.plan_date AS order_plan_date, o.priority AS order_priority
`;

function mapDeskRow(row, files = [], commentCount = 0) {
  const workspace = parseWorkspaceJson(row.constructor_workspace_json, {
    item: row.item,
    itemType: row.item_type
  });
  const requirements = getPositionRequirements(row);
  const completion = workspaceCompletion(workspace, files, row);
  return {
    id: row.id,
    parentId: row.parent_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    object: row.object,
    item: row.item,
    itemType: row.item_type,
    manager: row.manager,
    constructor: row.constructor_name || "",
    constructorUserId: row.constructor_user_id,
    constructorUserName: row.constructor_user_name || "",
    constructorAssignedAt: row.constructor_assigned_at,
    constructorDueAt: row.constructor_due_at,
    constructorEstimatedHours:
      row.constructor_estimated_hours != null ? Number(row.constructor_estimated_hours) : null,
    constructorDeskQueuedAt: row.constructor_desk_queued_at,
    hasConstructiveFile: Boolean(row.has_constructive_file),
    currentStage: row.current_stage,
    positionStatus: row.position_status,
    progress: row.progress ?? 0,
    orderClient: row.order_client || "",
    orderPlanDate: row.order_plan_date || "",
    orderPriority: row.order_priority || "",
    workspace,
    requirements,
    completion,
    commentCount,
    managerFilesCount: row.manager_files_count ?? 0,
    managerDataComplete: row.manager_data_complete ?? false
  };
}

function mapFileRow(row) {
  return {
    id: row.id,
    positionId: row.position_id,
    kind: row.kind,
    label: row.label,
    fileName: row.original_name,
    externalUrl: row.external_url,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    source: "workspace"
  };
}

/** Єдиний список файлів столу (position_files + legacy constructor_workspace_files). */
export async function listDeskWorkspaceFiles(positionId) {
  const managerFiles = await listManagerFiles(positionId);
  const seen = new Set();
  const files = [];

  for (const file of managerFiles) {
    const workspaceKind = file.legacyKind || managerKindToWorkspaceKind(file.kind);
    if (!workspaceKind || !isWorkspaceManagerKind(workspaceKind)) continue;

    const dedupeKey =
      file.source === "workspace" ? `ws:${String(file.id).replace(/^ws-/, "")}` : `pf:${file.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    files.push({
      id: file.id,
      positionId: file.positionId,
      kind: workspaceKind,
      label: file.fileName,
      fileName: file.fileName,
      externalUrl: file.externalUrl || null,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      uploadedBy: file.uploadedBy,
      createdAt: file.createdAt,
      source: file.source
    });
  }

  return files;
}

function mapCommentRow(row) {
  return {
    id: row.id,
    positionId: row.position_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at
  };
}

export function userCanManageDesk(user) {
  return user?.role === "admin" || Boolean(user?.permissions?.canManageConstructorDesk);
}

export function userCanWorkDesk(user) {
  return (
    userCanManageDesk(user) ||
    Boolean(user?.permissions?.canWorkConstructorDesk || user?.permissions?.canEditPositions)
  );
}

export function userCanAccessPositionDesk(user, row) {
  if (!userCanWorkDesk(user)) return false;
  if (userCanManageDesk(user)) return true;
  if (row.constructor_user_id && row.constructor_user_id === user.id) return true;
  const userName = String(user.name || "")
    .trim()
    .toLowerCase();
  const assignedName = String(row.constructor_name || "")
    .trim()
    .toLowerCase();
  return userName && assignedName && userName === assignedName;
}

/** Позиція передана конструкторам (етап конструктиву або явне призначення). */
export function isPositionOnConstructorDesk(row) {
  if (!row) return false;
  if (String(row.current_stage || "").trim() === "constructor") return true;
  if (row.constructor_desk_queued_at) return true;
  if (row.constructor_user_id != null) return true;
  if (row.constructor_assigned_at) return true;
  return Boolean(String(row.constructor_name || "").trim());
}

export async function listDeskPositions(user, { onlyMine = false } = {}) {
  const rows = await all(
    `SELECT ${POSITION_SELECT}
     FROM positions p
     LEFT JOIN users u ON u.id = p.constructor_user_id
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.position_status NOT IN ('Архів', 'Скасовано')
       AND (
         p.current_stage = 'constructor'
         OR p.constructor_desk_queued_at IS NOT NULL
         OR p.constructor_user_id IS NOT NULL
         OR p.constructor_assigned_at IS NOT NULL
         OR trim(coalesce(p.constructor_name, '')) <> ''
       )
     ORDER BY p.constructor_desk_queued_at NULLS LAST, p.constructor_due_at NULLS LAST, p.order_number, p.id`
  );

  const filtered = rows.filter((row) => {
    if (userCanManageDesk(user) && !onlyMine) return true;
    return userCanAccessPositionDesk(user, row);
  });

  const byOrder = new Map();
  for (const row of filtered) {
    const key = row.order_id != null ? `id:${row.order_id}` : `num:${row.order_number}`;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(row);
  }
  const workIds = new Set();
  for (const group of byOrder.values()) {
    const work = getWorkPositions(
      { id: group[0].order_id, orderNumber: group[0].order_number },
      group.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        item: r.item,
        itemType: r.item_type
      }))
    );
    work.forEach((p) => workIds.add(p.id));
  }
  const workRows = filtered.filter((r) => workIds.has(r.id));

  const ids = workRows.map((r) => r.id);
  if (!ids.length) return [];

  const fileRows = await all(
    `SELECT position_id, kind, external_url FROM (
       SELECT position_id, kind, external_url
       FROM constructor_workspace_files
       WHERE position_id = ANY($1::int[])
         AND kind IN ('tech', 'measurements', 'manager_image', 'custom')
       UNION ALL
       SELECT position_id,
         CASE kind
           WHEN 'manager_appliance' THEN 'tech'
           WHEN 'manager_measurement' THEN 'measurements'
           WHEN 'manager_photo' THEN 'manager_image'
           ELSE 'custom'
         END AS kind,
         NULL::text AS external_url
       FROM position_files
       WHERE position_id = ANY($1::int[]) AND kind LIKE 'manager_%'
     ) unified`,
    [ids]
  );
  const commentRows = await all(
    `SELECT position_id, COUNT(*)::int AS cnt
     FROM constructor_workspace_comments WHERE position_id = ANY($1::int[])
     GROUP BY position_id`,
    [ids]
  );
  const filesByPos = new Map();
  for (const f of fileRows) {
    const list = filesByPos.get(f.position_id) || [];
    list.push({
      kind: f.kind,
      externalUrl: f.external_url || null
    });
    filesByPos.set(f.position_id, list);
  }
  const commentsByPos = new Map(commentRows.map((r) => [r.position_id, r.cnt]));

  const managerCounts = await all(
    `SELECT position_id, SUM(cnt)::int AS cnt FROM (
       SELECT position_id, COUNT(*)::int AS cnt
       FROM position_files
       WHERE position_id = ANY($1::int[]) AND kind LIKE 'manager_%'
       GROUP BY position_id
       UNION ALL
       SELECT position_id, COUNT(*)::int AS cnt
       FROM constructor_workspace_files
       WHERE position_id = ANY($1::int[])
         AND kind IN ('tech', 'measurements', 'manager_image', 'custom')
       GROUP BY position_id
     ) merged GROUP BY position_id`,
    [ids]
  );
  const managerCountByPos = new Map(managerCounts.map((r) => [r.position_id, r.cnt]));

  return workRows.map((row) => {
    const managerFilesCount = managerCountByPos.get(row.id) || 0;
    const managerData = buildManagerDataFromRow(row);
    const managerDataComplete = isManagerDataComplete(row, managerData, { managerFilesCount });
    return mapDeskRow(
      {
        ...row,
        manager_files_count: managerFilesCount,
        manager_data_complete: managerDataComplete
      },
      filesByPos.get(row.id) || [],
      commentsByPos.get(row.id) || 0
    );
  });
}

function positionHasConstructorAssignment(p) {
  if (p.constructorUserId != null) return true;
  if (String(p.constructorUserName || "").trim()) return true;
  if (
    Object.prototype.hasOwnProperty.call(p, "constructor") &&
    String(p.constructor || "").trim()
  ) {
    return true;
  }
  return false;
}

export function groupDeskPositionsIntoOrders(positions = []) {
  const byKey = new Map();
  for (const p of positions) {
    const key = p.orderId != null ? `id:${p.orderId}` : `num:${p.orderNumber || p.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        orderId: p.orderId ?? null,
        orderNumber: p.orderNumber || "—",
        object: p.object || "",
        orderClient: p.orderClient || "",
        orderPlanDate: p.orderPlanDate || "",
        orderPriority: p.orderPriority || "",
        positionCount: 0,
        assignedCount: 0,
        pendingCount: 0,
        maxCompletionPercent: 0,
        nearestDueAt: null,
        positions: []
      });
    }
    const entry = byKey.get(key);
    entry.positions.push(p);
    entry.positionCount += 1;
    if (positionHasConstructorAssignment(p)) entry.assignedCount += 1;
    else entry.pendingCount += 1;
    const pct = p.completion?.percent ?? 0;
    if (pct > entry.maxCompletionPercent) entry.maxCompletionPercent = pct;
    if (p.constructorDueAt) {
      const due = new Date(p.constructorDueAt).getTime();
      const prev = entry.nearestDueAt ? new Date(entry.nearestDueAt).getTime() : Infinity;
      if (due < prev) entry.nearestDueAt = p.constructorDueAt;
    }
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.orderNumber).localeCompare(String(b.orderNumber), "uk")
  );
}

export async function listDeskOrders(user, options = {}) {
  await repairConstructorDeskQueue();
  const positions = await listDeskPositions(user, options);
  return groupDeskPositionsIntoOrders(positions);
}

export async function getDeskPosition(user, positionId) {
  const row = await one(
    `SELECT ${POSITION_SELECT}
     FROM positions p
     LEFT JOIN users u ON u.id = p.constructor_user_id
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1`,
    [positionId]
  );
  if (!row) return null;
  if (!userCanAccessPositionDesk(user, row)) return { forbidden: true };

  const files = await listDeskWorkspaceFiles(positionId);

  const comments = (
    await all(
      `SELECT * FROM constructor_workspace_comments WHERE position_id = $1 ORDER BY created_at DESC`,
      [positionId]
    )
  ).map(mapCommentRow);

  const childCount = Number(
    (await one(`SELECT COUNT(*)::int AS cnt FROM positions WHERE parent_id = $1`, [positionId]))
      ?.cnt || 0
  );

  const managerFiles = await listManagerFiles(positionId);

  return {
    position: mapDeskRow(row, files, comments.length),
    files,
    managerFiles,
    comments,
    childCount
  };
}

export async function assignConstructorDesk(user, positionId, body = {}) {
  if (!userCanManageDesk(user)) {
    const err = new Error("Недостатньо прав для призначення конструктора");
    err.status = 403;
    throw err;
  }
  const row = await one(`SELECT id FROM positions WHERE id = $1`, [positionId]);
  if (!row) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }

  const constructorUserId = body.constructorUserId ? Number(body.constructorUserId) : null;
  let constructorName = String(body.constructorName || "").trim();
  const assignable = await listConstructorUsers();

  if (constructorUserId) {
    if (!assignable.some((u) => u.id === constructorUserId)) {
      const err = new Error("Обраного конструктора немає у довіднику «Конструктори»");
      err.status = 400;
      throw err;
    }
    const u = await one(`SELECT name FROM users WHERE id = $1`, [constructorUserId]);
    if (u?.name) constructorName = u.name;
  } else if (constructorName) {
    const match = assignable.find(
      (u) => normalizePersonName(u.name) === normalizePersonName(constructorName)
    );
    if (!match) {
      const err = new Error("Обраного конструктора немає у довіднику «Конструктори»");
      err.status = 400;
      throw err;
    }
    constructorName = match.name;
  }

  const hasAssignment = Boolean(constructorUserId || constructorName);

  await run(
    `UPDATE positions SET
      constructor_user_id = $2,
      constructor_name = $3,
      constructor_assigned_at = CASE
        WHEN $6 THEN COALESCE(constructor_assigned_at, now())
        ELSE NULL
      END,
      constructor_due_at = $4,
      constructor_estimated_hours = $5,
      assignment_comment = COALESCE($7, assignment_comment)
     WHERE id = $1`,
    [
      positionId,
      constructorUserId || null,
      constructorName,
      body.constructorDueAt || null,
      body.constructorEstimatedHours != null ? Number(body.constructorEstimatedHours) : null,
      hasAssignment,
      body.assignmentComment != null ? String(body.assignmentComment).trim() : null
    ]
  );

  let orderStatusSync = { updated: false };
  if (hasAssignment) {
    const posRow = await one(`SELECT order_id FROM positions WHERE id = $1`, [positionId]);
    if (posRow?.order_id) {
      const orderRow = await one(`SELECT * FROM orders WHERE id = $1`, [posRow.order_id]);
      if (orderRow) {
        orderStatusSync = await syncOrderStatusAfterConstructorAssignment(orderRow, {
          actor: user
        });
      }
    }
  }

  const detail = await getDeskPosition(user, positionId);
  return { ...detail, orderStatusSync };
}

export async function saveDeskWorkspace(user, positionId, body = {}) {
  const existing = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!existing) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }
  if (!userCanAccessPositionDesk(user, existing)) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }

  const workspace = {
    ...parseWorkspaceJson(existing.constructor_workspace_json, existing),
    ...(body.workspace || {})
  };
  workspace.ledLighting = {
    ...parseWorkspaceJson(existing.constructor_workspace_json, existing).ledLighting,
    ...(body.workspace?.ledLighting || {})
  };
  if (body.workspace?.customLinks) {
    workspace.customLinks = body.workspace.customLinks;
  }

  const deskFiles = await listDeskWorkspaceFiles(positionId);
  const errors = validateWorkspacePayload(
    {
      ...workspace,
      files: deskFiles.map((f) => ({ kind: f.kind, externalUrl: f.externalUrl }))
    },
    existing
  );
  if (errors.length && body.strict !== false) {
    const err = new Error(errors.join("; "));
    err.status = 400;
    err.details = errors;
    throw err;
  }

  await run(`UPDATE positions SET constructor_workspace_json = $2 WHERE id = $1`, [
    positionId,
    JSON.stringify(workspace)
  ]);

  if (body.techLink != null) {
    const ws = parseWorkspaceJson(
      (await one(`SELECT constructor_workspace_json FROM positions WHERE id = $1`, [positionId]))
        ?.constructor_workspace_json,
      existing
    );
    ws.techLink = String(body.techLink || "").trim();
    await run(`UPDATE positions SET constructor_workspace_json = $2 WHERE id = $1`, [
      positionId,
      JSON.stringify(ws)
    ]);
  }

  return getDeskPosition(user, positionId);
}

export async function addDeskComment(user, positionId, body = {}) {
  const existing = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!existing) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }
  if (!userCanAccessPositionDesk(user, existing) && !userCanManageDesk(user)) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }
  const bodyText = String(body.body || "").trim();
  if (!bodyText) {
    const err = new Error("Коментар порожній");
    err.status = 400;
    throw err;
  }

  await run(
    `INSERT INTO constructor_workspace_comments (position_id, author_id, author_name, author_role, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [positionId, user.id, user.name || "", user.role || "", bodyText]
  );

  return getDeskPosition(user, positionId);
}

export async function uploadDeskFile(
  user,
  positionId,
  { kind, label, fileName, mime, dataBase64, externalUrl }
) {
  const existing = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!existing) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }
  if (!userCanAccessPositionDesk(user, existing)) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }

  const fileKind = kind || "custom";
  const actor = { id: user.id, name: user.name || "", role: user.role || "" };

  if (isWorkspaceManagerKind(fileKind)) {
    const managerKind = workspaceKindToManagerKind(fileKind);
    const url = String(externalUrl || "").trim();

    if (url && !dataBase64) {
      const bundle = await getPositionManagerBundle(positionId);
      const md = bundle?.managerData || defaultManagerDataJson();
      const title = String(label || fileName || "Посилання").trim();

      if (fileKind === "tech") {
        const has = (md.appliances || []).some((a) => String(a.url || "").trim() === url);
        if (!has) {
          md.appliances = [...(md.appliances || []), { title, url, note: "" }];
        }
      } else {
        const has = (md.sourceLinks || []).some((l) => String(l.url || "").trim() === url);
        if (!has) {
          md.sourceLinks = [...(md.sourceLinks || []), { title, url, kind: managerKind }];
        }
      }

      await saveManagerData(positionId, md, actor);
      return {
        id: `link-${Date.now()}`,
        kind: fileKind,
        label: title,
        externalUrl: url,
        originalName: title,
        source: "manager_data"
      };
    }

    if (dataBase64) {
      const uploaded = await uploadManagerFile(
        positionId,
        {
          kind: managerKind,
          fileName: fileName || "file",
          mime,
          dataBase64,
          comment: label || ""
        },
        actor
      );
      return {
        id: uploaded.id,
        kind: fileKind,
        label: label || uploaded.fileName || "",
        originalName: uploaded.fileName || fileName || "",
        mime: uploaded.mime || mime || "",
        sizeBytes: uploaded.sizeBytes || 0,
        source: "position_files"
      };
    }
  }

  let storagePath = "";
  let originalName = "";
  let sizeBytes = 0;
  let fileMime = mime || "";

  if (dataBase64) {
    const buffer = Buffer.from(dataBase64, "base64");
    const saved = await saveConstructiveFile(positionId, {
      buffer,
      originalName: fileName || "file",
      mime: mime || "application/octet-stream"
    });
    storagePath = saved.storagePath;
    originalName = saved.originalName;
    sizeBytes = saved.size;
    fileMime = saved.mime;
  }

  const row = await one(
    `INSERT INTO constructor_workspace_files (
      position_id, kind, label, original_name, storage_path, external_url, mime, size_bytes, uploaded_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      positionId,
      kind || "custom",
      label || "",
      originalName || fileName || "",
      storagePath,
      externalUrl || "",
      fileMime,
      sizeBytes,
      user.id
    ]
  );

  return mapFileRow(row);
}

export async function getDeskFileForDownload(positionId, fileIdRaw) {
  return getManagerFileForDownload(positionId, fileIdRaw);
}

export async function suggestTimingForPosition(user, positionId) {
  const data = await getDeskPosition(user, positionId);
  if (!data || data.forbidden) {
    const err = new Error("Недостатньо прав");
    err.status = 403;
    throw err;
  }
  if (!userCanManageDesk(user)) {
    const err = new Error(
      "Оцінку таймінгу може робити головний конструктор або начальник виробництва"
    );
    err.status = 403;
    throw err;
  }
  const managerFiles = data.managerFiles || [];
  const managerData = buildManagerDataFromRow(data.position);
  return suggestConstructorTiming(data.position, {
    childCount: data.childCount,
    managerFilesCount: managerFiles.length,
    managerPdfCount: managerFiles.filter(
      (f) => f.kind === "manager_pdf" || String(f.mime || "").includes("pdf")
    ).length,
    managerPhotoCount: managerFiles.filter((f) => f.kind === "manager_photo").length,
    applianceCount: managerData.appliances?.length || 0,
    orderPlanDate: data.position.orderPlanDate || data.position.order_plan_date || "",
    positionDeadline: data.position.positionDeadline || data.position.position_deadline || ""
  });
}

export async function listConstructorUsers() {
  const dirs = await getDirectories();
  const rows = await all(
    `SELECT id, name, login, role FROM users WHERE active = TRUE ORDER BY name`
  );
  return buildConstructorAssigneesFromDirectory(
    getDirectoryList(dirs, CONSTRUCTORS_DIRECTORY_KEY),
    rows.map((r) => ({ id: r.id, name: r.name, login: r.login, role: r.role }))
  );
}
