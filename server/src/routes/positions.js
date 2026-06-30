import { Router } from "express";
import { all, one, run } from "../db.js";
import { mapPosition, positionToDb } from "../mappers.js";
import {
  logPositionCreate,
  logPositionDelete,
  logPositionUpdate,
  logStageChangeWithAutoHandoffs
} from "../audit.js";
import {
  auditActor,
  requireAuth,
  requirePositionWrite,
  requireBusinessDataAccess
} from "../middleware/auth.js";
import {
  STAGE_PATCH_MAP,
  applyStageHandoff,
  detectAutoHandoffs,
  enrichPositionRow
} from "../position-logic.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import {
  closeOperatorSessionsForStage,
  closeSessionsAfterStageStatusChanges,
  OPERATOR_ACTIVE_STATUSES
} from "../operator-sessions.js";
import { nextPositionId } from "../db/position-id.js";
import { insertPosition, updatePositionFull } from "../db/position-persistence.js";
import {
  AI_COUNT_SUBQUERY,
  ACTIVE_SESSION_SUBQUERY,
  enrichAndMapPosition
} from "../godmode-enrich.js";
import QRCode from "qrcode";
import { buildOperatorDeepLink } from "../qr-link.js";
import { loadStageTimestampsMap, stageTimestampsForPosition } from "../stage-timestamps.js";
import { registerConstructiveRoutes } from "./positions/constructive-routes.js";
import { registerNextActionRoutes } from "./positions/next-action-routes.js";
import { registerManagerRoutes } from "./positions/manager-routes.js";
import constructivePackageRouter, {
  registerConstructivePackagePositionRoutes
} from "./constructive-packages.js";
import {
  CONSTRUCTIVE_FILE_COUNT_SUBQUERY,
  CONSTRUCTIVE_FILE_NAME_SUBQUERY
} from "../constructive-files-service.js";
import {
  HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY,
  HAS_PROCUREMENT_REQUEST_SUBQUERY,
  HAS_PROCUREMENT_SOURCE_SUBQUERY,
  PACKAGE_ID_SUBQUERY,
  PACKAGE_PARTS_COUNT_SUBQUERY,
  PACKAGE_STATUS_SUBQUERY,
  PACKAGE_VERSION_SUBQUERY,
  PROCUREMENT_REQUEST_STATUS_SUBQUERY,
  UNMAPPED_PARTS_SUBQUERY
} from "../constructive-package-enrich.js";
import {
  MANAGER_FILE_COUNT_SUBQUERY,
  getPositionManagerBundle
} from "../position-manager-service.js";
import { getProcurementRequest } from "../constructive/procurement-service.js";
import { getCncJobsForPosition } from "../integrations/cnc-jobs.js";
import { listPackagesForPosition } from "../constructive/constructive-package-service.js";
import { syncOrderStatusFromPositions } from "../order-status-from-positions.js";

const router = Router();
router.use(requireAuth);

async function planDateByOrderNumber() {
  const rows = await all("SELECT id, order_number, plan_date FROM orders");
  const byId = new Map();
  const byNumber = new Map();
  for (const o of rows) {
    byId.set(o.id, o.plan_date);
    byNumber.set(o.order_number, o.plan_date);
  }
  return {
    byId,
    byNumber,
    get(orderNumber) {
      return byNumber.get(orderNumber);
    },
    forRow(row) {
      if (row?.order_id != null && byId.has(row.order_id)) return byId.get(row.order_id);
      return byNumber.get(row?.order_number);
    }
  };
}

function mapEnrichedRow(row, planMap, extraContext = {}) {
  const planDate = planMap.forRow(row);
  return enrichAndMapPosition(row, planDate, {
    hasAiAnalysis: Number(row.ai_analysis_count) > 0,
    hasActiveOperatorSession: Number(row.active_operator_sessions) > 0,
    ...extraContext
  });
}

const POSITION_SELECT = `SELECT p.*,
  ${CONSTRUCTIVE_FILE_NAME_SUBQUERY},
  ${CONSTRUCTIVE_FILE_COUNT_SUBQUERY},
  ${PACKAGE_STATUS_SUBQUERY},
  ${PACKAGE_ID_SUBQUERY},
  ${PACKAGE_VERSION_SUBQUERY},
  ${HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY},
  ${UNMAPPED_PARTS_SUBQUERY},
  ${PACKAGE_PARTS_COUNT_SUBQUERY},
  ${HAS_PROCUREMENT_SOURCE_SUBQUERY},
  ${HAS_PROCUREMENT_REQUEST_SUBQUERY},
  ${PROCUREMENT_REQUEST_STATUS_SUBQUERY},
  ${MANAGER_FILE_COUNT_SUBQUERY},
  ${AI_COUNT_SUBQUERY},
  ${ACTIVE_SESSION_SUBQUERY}
 FROM positions p`;

async function loadRow(id) {
  return one(`${POSITION_SELECT} WHERE p.id = $1`, [id]);
}

async function saveRow(id, data, planDate, { actor = null } = {}) {
  const enriched = enrichPositionRow(data, { planDate });
  await updatePositionFull({ ...enriched, id });
  const saved = mapPosition(enrichPositionRow(await loadRow(id), { planDate }));
  if (saved.orderId) {
    await syncOrderStatusFromPositions(saved.orderId, { actor });
  }
  return saved;
}

async function resolveParentLink(data) {
  if (!data.parent_id) return data;
  const parent = await one("SELECT * FROM positions WHERE id = $1", [data.parent_id]);
  if (!parent) {
    const err = new Error("Батьківську позицію не знайдено");
    err.status = 400;
    throw err;
  }
  if (parent.parent_id) {
    const err = new Error("Підпозицію можна додати лише до основної позиції");
    err.status = 400;
    throw err;
  }
  data.order_id = parent.order_id;
  data.order_number = parent.order_number;
  data.object = data.object || parent.object;
  data.manager = data.manager || parent.manager;
  if (!data.item_type) data.item_type = parent.item_type;
  return data;
}

async function resolveOrderLink(data) {
  if (data.order_id) {
    const order = await one("SELECT * FROM orders WHERE id = $1", [data.order_id]);
    if (order) {
      data.order_number = order.order_number;
      if (!data.object) data.object = order.object;
      if (!data.manager) data.manager = order.manager;
    }
  } else if (data.order_number) {
    const order = await one("SELECT id, object, manager FROM orders WHERE order_number = $1", [
      data.order_number
    ]);
    if (order) {
      data.order_id = order.id;
      if (!data.object) data.object = order.object;
      if (!data.manager) data.manager = order.manager;
    }
  }
  return data;
}

const routeCtx = { loadRow, saveRow, planDateByOrderNumber, mapEnrichedRow };
registerNextActionRoutes(router, routeCtx);
registerConstructiveRoutes(router, routeCtx);
registerManagerRoutes(router, routeCtx);
router.use("/:id/constructive-packages", constructivePackageRouter);
registerConstructivePackagePositionRoutes(router);

router.get("/", requireBusinessDataAccess, async (_req, res) => {
  const planMap = await planDateByOrderNumber();
  const rows = await all(
    `${POSITION_SELECT}
     ORDER BY COALESCE(p.parent_id, p.id), CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.id`
  );
  const subsByOrderId = new Set();
  const subsByOrderNumber = new Set();
  for (const row of rows) {
    if (row.parent_id != null) {
      if (row.order_id != null) subsByOrderId.add(row.order_id);
      if (row.order_number) subsByOrderNumber.add(row.order_number);
    }
  }
  const tsMap = await loadStageTimestampsMap(rows.map((r) => r.id));
  const now = new Date();
  res.json(
    rows.map((row) =>
      mapEnrichedRow(row, planMap, {
        stageTimestamps: stageTimestampsForPosition(tsMap, row.id),
        now,
        orderHasSubPositions:
          (row.order_id != null && subsByOrderId.has(row.order_id)) ||
          Boolean(row.order_number && subsByOrderNumber.has(row.order_number))
      })
    )
  );
});

router.get("/:id/qr", async (req, res) => {
  const id = Number(req.params.id);
  const row = await loadRow(id);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  const stageKey = String(req.query.stage || row.current_stage || "cutting");
  const url = buildOperatorDeepLink({ positionId: id, stageKey, req });

  if (req.query.format === "json") {
    res.json({ url, positionId: id, stageKey, orderNumber: row.order_number, item: row.item });
    return;
  }

  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 256 });
  res.type("image/svg+xml").send(svg);
});

router.get("/:id", requireBusinessDataAccess, async (req, res) => {
  const row = await one(`${POSITION_SELECT} WHERE p.id = $1`, [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  const planMap = await planDateByOrderNumber();
  const tsMap = await loadStageTimestampsMap([row.id]);
  const mapped = mapEnrichedRow(row, planMap, {
    stageTimestamps: stageTimestampsForPosition(tsMap, row.id),
    now: new Date()
  });
  const managerBundle = await getPositionManagerBundle(row.id);
  const packages = await listPackagesForPosition(row.id);
  const procurement = await one(
    `SELECT id FROM procurement_requests WHERE position_id = $1 ORDER BY id DESC LIMIT 1`,
    [row.id]
  );
  const procurementDetail = procurement ? await getProcurementRequest(procurement.id) : null;
  const cncJobs = await getCncJobsForPosition(row.id);

  res.json({
    ...mapped,
    managerData: managerBundle?.managerData ?? null,
    managerFiles: managerBundle?.files ?? [],
    managerDataComplete: managerBundle?.managerDataComplete ?? false,
    constructivePackages: packages,
    procurement: procurementDetail,
    cncJobs
  });
});

router.post("/", requirePositionWrite, async (req, res) => {
  let raw;
  try {
    raw = await resolveParentLink(await resolveOrderLink(positionToDb(req.body)));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }
  if (!raw.item) {
    res.status(400).json({ error: "Вкажіть назву підпозиції / виробу" });
    return;
  }
  if (!raw.order_number) {
    res.status(400).json({ error: "Вкажіть номер замовлення" });
    return;
  }

  if (!raw.parent_id) {
    const existingRoot = await one(
      `SELECT id FROM positions
       WHERE parent_id IS NULL
         AND (order_id = $1 OR order_number = $2)
       LIMIT 1`,
      [raw.order_id, raw.order_number]
    );
    if (existingRoot) {
      res.status(400).json({
        error:
          "У замовленні вже є основна позиція. Додайте виріб або зону як підпозицію через + біля неї."
      });
      return;
    }
  }

  const id = await nextPositionId();
  const planMap = await planDateByOrderNumber();
  const planDate = planMap.forRow(raw);
  const enriched = enrichPositionRow({ ...raw, id }, { planDate });

  await insertPosition(enriched);

  const row = await loadRow(id);
  await logPositionCreate(row, auditActor(req));
  res.status(201).json(mapEnrichedRow(row, planMap));
});

router.put("/:id", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await loadRow(id);
  if (!existing) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const current = mapPosition(existing);
  const merged = { ...current, ...req.body };
  let raw;
  try {
    raw = await resolveParentLink(await resolveOrderLink({ ...positionToDb(merged), id }));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
    return;
  }

  if (raw.parent_id === id) {
    res.status(400).json({ error: "Позиція не може бути підпозицією самої себе" });
    return;
  }

  if (!raw.item) {
    res.status(400).json({ error: "Вкажіть назву виробу" });
    return;
  }

  const planMap = await planDateByOrderNumber();
  const planDate = planMap.forRow(raw);
  const saved = await saveRow(id, raw, planDate, { actor: auditActor(req) });
  await closeSessionsAfterStageStatusChanges(existing, raw, id);
  await logPositionUpdate(existing, await loadRow(id), auditActor(req));
  res.json(saved);
});

router.patch("/:id/stage/:stageKey", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const stageKey = req.params.stageKey;
  const config = STAGE_PATCH_MAP[stageKey];

  if (!config) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }

  const beforeRow = await loadRow(id);
  if (!beforeRow) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const existing = { ...beforeRow };
  const { status, constructor, assemblyResponsible } = req.body;

  if (config.type === "constructor") {
    if (constructor !== undefined) existing.constructor_name = String(constructor).trim();
    if (status === "Не розпочато") {
      existing.constructor_name = "";
      existing.has_constructive_file = false;
    } else if (
      status &&
      status !== "Не розпочато" &&
      !existing.has_constructive_file &&
      !existing.constructor_name
    ) {
      res.status(400).json({ error: "Завантажте файл конструктива або вкажіть конструктора" });
      return;
    }
  } else {
    if (!status) {
      res.status(400).json({ error: "Вкажіть статус етапу" });
      return;
    }
    existing[config.field] = status;
    if (assemblyResponsible !== undefined) {
      existing.assembly_responsible = String(assemblyResponsible).trim();
    }
    if (status === "Готово" && !existing.ready_date) {
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      existing.ready_date = `${dd}.${mm}.${today.getFullYear()}`;
    }
  }

  const planMap = await planDateByOrderNumber();
  const planDate = planMap.forRow(existing);
  const handedOff = applyStageHandoff(existing, stageKey, {
    status,
    constructor,
    assemblyResponsible
  });
  await saveRow(id, handedOff, planDate, { actor: auditActor(req) });
  const afterRow = await loadRow(id);
  if (config.type !== "constructor" && status && !OPERATOR_ACTIVE_STATUSES.has(status)) {
    await closeOperatorSessionsForStage(id, stageKey);
  }
  const autoHandoffs = detectAutoHandoffs(beforeRow, afterRow, stageKey);
  await logStageChangeWithAutoHandoffs(
    beforeRow,
    afterRow,
    stageKey,
    { status, constructor },
    auditActor(req),
    autoHandoffs
  );
  res.json(mapEnrichedRow(afterRow, planMap));
});

router.post("/:id/create-tasks", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await loadRow(id);
  if (!existing) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const valid = stages.filter((k) => STAGE_STATUS_FIELD[k]);
  if (!valid.length) {
    res.status(400).json({ error: "Оберіть хоча б один етап" });
    return;
  }

  const { applyStagesToPosition } = await import("../automation/auto-create-tasks.js");
  const result = await applyStagesToPosition(id, valid, { actor: auditActor(req) });
  if (!result.applied) {
    res.status(400).json({ error: "Не вдалося створити задачі", reason: result.reason });
    return;
  }

  const planMap = await planDateByOrderNumber();
  const afterRow = await loadRow(id);
  res.json(mapEnrichedRow(afterRow, planMap));
});

router.post("/:id/create-tasks-from-ai", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await loadRow(id);
  if (!existing) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const { loadLatestAiAnalysisForPosition } = await import("../automation/analysis-loader.js");
  const { tryAutoCreateTasksFromAnalysis } = await import("../automation/auto-create-tasks.js");
  const latest = await loadLatestAiAnalysisForPosition(id);
  if (!latest?.analysis) {
    res.status(400).json({ error: "Немає ШІ-аналізу для цієї позиції" });
    return;
  }

  const mode = req.body?.mode === "strict" ? "strict" : "assisted";
  const result = await tryAutoCreateTasksFromAnalysis(id, latest.analysis, {
    source: latest.source,
    actor: auditActor(req),
    mode
  });

  if (!result.applied) {
    const messages = {
      disabled: "Автостворення задач вимкнено в налаштуваннях",
      no_matching_stages: "Немає етапів з достатньою впевненістю для створення",
      tasks_exist: "Задачі вже створені",
      child_position: "Дочірня позиція не підтримується",
      not_found: "Позицію не знайдено"
    };
    res.status(400).json({
      error: messages[result.reason] || "Не вдалося створити задачі з ШІ",
      reason: result.reason
    });
    return;
  }

  const planMap = await planDateByOrderNumber();
  const afterRow = await loadRow(id);
  res.json({
    ...mapEnrichedRow(afterRow, planMap),
    createdStages: result.stages,
    analysisSource: latest.source
  });
});

router.patch("/:id/install", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const beforeRow = await loadRow(id);
  if (!beforeRow) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const existing = { ...beforeRow };
  const {
    installDate,
    installEndDate,
    installTimeStart,
    installTimeEnd,
    installResponsible,
    clear
  } = req.body;

  if (clear) {
    existing.install_date = "";
    existing.install_end_date = "";
    existing.install_time_start = "";
    existing.install_time_end = "";
  } else {
    if (installDate !== undefined) existing.install_date = String(installDate).trim();
    if (installEndDate !== undefined) existing.install_end_date = String(installEndDate).trim();
    if (installTimeStart !== undefined)
      existing.install_time_start = String(installTimeStart).trim();
    if (installTimeEnd !== undefined) existing.install_time_end = String(installTimeEnd).trim();
    if (existing.install_date && !existing.install_end_date) {
      existing.install_end_date = existing.install_date;
    }
    if (installResponsible !== undefined) {
      existing.install_responsible = String(installResponsible).trim();
    }
  }

  if (existing.install_date && existing.position_status === "Готово до встановлення") {
    existing.position_status = "На встановленні";
  }

  const planMap = await planDateByOrderNumber();
  const planDate = planMap.forRow(existing);
  await saveRow(id, existing, planDate);
  const afterRow = await loadRow(id);
  await logPositionUpdate(beforeRow, afterRow, auditActor(req));
  res.json(mapEnrichedRow(afterRow, planMap));
});

router.delete("/:id", requirePositionWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await loadRow(id);
  if (!existing) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  const activeSessions = Number(existing.active_operator_sessions) || 0;
  if (activeSessions > 0) {
    res.status(409).json({
      error: "Неможливо видалити позицію — оператор працює над нею."
    });
    return;
  }
  await logPositionDelete(existing, auditActor(req));
  await run("DELETE FROM positions WHERE id = $1", [id]);
  res.status(204).send();
});

export default router;
