import { Router } from "express";
import { all, one, run } from "../db.js";
import { mapPosition, positionToDb } from "../mappers.js";
import {
  logPositionCreate,
  logPositionDelete,
  logPositionUpdate,
  logStageChange
} from "../audit.js";
import { auditActor, requireAuth, requirePositionWrite } from "../middleware/auth.js";
import { STAGE_PATCH_MAP, enrichPositionRow } from "../position-logic.js";

const router = Router();
router.use(requireAuth);

async function planDateByOrderNumber() {
  const rows = await all("SELECT order_number, plan_date FROM orders");
  const map = new Map();
  for (const o of rows) {
    map.set(o.order_number, o.plan_date);
  }
  return map;
}

function mapEnrichedRow(row, planMap) {
  const planDate = planMap.get(row.order_number);
  return mapPosition(enrichPositionRow(row, { planDate }));
}

async function nextPositionId() {
  const row = await one("SELECT MAX(id) AS maxid FROM positions");
  return (row.maxid ?? 1000) + 1;
}

async function loadRow(id) {
  return one("SELECT * FROM positions WHERE id = $1", [id]);
}

async function saveRow(id, data, planDate) {
  const enriched = enrichPositionRow(data, { planDate });
  await run(
    `UPDATE positions SET
      parent_id = @parent_id,
      order_id = @order_id,
      order_number = @order_number,
      object = @object,
      item = @item,
      item_type = @item_type,
      manager = @manager,
      constructor_name = @constructor_name,
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      assembly_responsible = @assembly_responsible,
      ready_date = @ready_date,
      install_date = @install_date,
      install_end_date = @install_end_date,
      install_time_start = @install_time_start,
      install_time_end = @install_time_end,
      install_responsible = @install_responsible,
      position_status = @position_status,
      progress = @progress,
      overdue_days = @overdue_days,
      problem = @problem,
      note = @note
    WHERE id = @id`,
    { ...enriched, id }
  );
  return mapPosition(enrichPositionRow(await loadRow(id), { planDate }));
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
    const order = await one(
      "SELECT id, object, manager FROM orders WHERE order_number = $1",
      [data.order_number]
    );
    if (order) {
      data.order_id = order.id;
      if (!data.object) data.object = order.object;
      if (!data.manager) data.manager = order.manager;
    }
  }
  return data;
}

router.get("/", async (_req, res) => {
  const planMap = await planDateByOrderNumber();
  const rows = await all(
    `SELECT * FROM positions
     ORDER BY COALESCE(parent_id, id), CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id`
  );
  res.json(rows.map((row) => mapEnrichedRow(row, planMap)));
});

router.get("/:id", async (req, res) => {
  const row = await loadRow(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  const planMap = await planDateByOrderNumber();
  res.json(mapEnrichedRow(row, planMap));
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

  const id = await nextPositionId();
  const planMap = await planDateByOrderNumber();
  const planDate = planMap.get(raw.order_number);
  const enriched = enrichPositionRow({ ...raw, id }, { planDate });

  await run(
    `INSERT INTO positions (
      id, parent_id, order_id, order_number, object, item, item_type, manager, constructor_name,
      cutting_status, edging_status, drilling_status, assembly_status, assembly_responsible,
      ready_date, install_date, install_end_date, install_time_start, install_time_end, install_responsible, position_status, progress, overdue_days, problem, note
    ) VALUES (
      @id, @parent_id, @order_id, @order_number, @object, @item, @item_type, @manager, @constructor_name,
      @cutting_status, @edging_status, @drilling_status, @assembly_status, @assembly_responsible,
      @ready_date, @install_date, @install_end_date, @install_time_start, @install_time_end, @install_responsible, @position_status, @progress, @overdue_days, @problem, @note
    )`,
    enriched
  );

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
  const planDate = planMap.get(raw.order_number);
  const saved = await saveRow(id, raw, planDate);
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
    if (status === "Не розпочато") existing.constructor_name = "";
    else if (status && status !== "Не розпочато" && !existing.constructor_name) {
      res.status(400).json({ error: "Вкажіть конструктора" });
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
  const planDate = planMap.get(existing.order_number);
  await saveRow(id, existing, planDate);
  const afterRow = await loadRow(id);
  await logStageChange(beforeRow, afterRow, stageKey, { status, constructor }, auditActor(req));
  res.json(mapEnrichedRow(afterRow, planMap));
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
  const planDate = planMap.get(existing.order_number);
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
  await logPositionDelete(existing, auditActor(req));
  await run("DELETE FROM positions WHERE id = $1", [id]);
  res.status(204).send();
});

export default router;
