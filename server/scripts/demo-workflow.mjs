#!/usr/bin/env node
import pg from "pg";
import { enrichPositionRow } from "../src/position-logic.js";
import { POSITION_BASE_COLUMNS } from "../src/db/position-persistence.js";

const DONE_ORDER_STATUS = "Завершено";

function uaDate(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function makePositionBase({ id, orderId, orderNumber, object, item, manager }) {
  return {
    id,
    parent_id: null,
    order_id: orderId,
    order_number: orderNumber,
    object,
    item,
    item_type: "Інше",
    manager,
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
}

function stagePosition(base, variant) {
  const copy = { ...base };
  if (variant === "constructor") {
    copy.constructor_name = "Конструктор Демо";
  } else if (variant === "cutting") {
    copy.constructor_name = "Конструктор Демо";
    copy.cutting_status = "В роботі";
  } else if (variant === "edging") {
    copy.constructor_name = "Конструктор Демо";
    copy.cutting_status = "Готово";
    copy.edging_status = "В роботі";
  } else if (variant === "drilling") {
    copy.constructor_name = "Конструктор Демо";
    copy.cutting_status = "Готово";
    copy.edging_status = "Готово";
    copy.drilling_status = "В роботі";
    copy.assembly_responsible = "Майстер Присадки";
  } else if (variant === "assembly") {
    copy.constructor_name = "Конструктор Демо";
    copy.cutting_status = "Готово";
    copy.edging_status = "Готово";
    copy.drilling_status = "Готово";
    copy.assembly_status = "В роботі";
    copy.assembly_responsible = "Майстер Збірки";
  } else if (variant === "readyInstall") {
    copy.constructor_name = "Конструктор Демо";
    copy.cutting_status = "Готово";
    copy.edging_status = "Готово";
    copy.drilling_status = "Готово";
    copy.assembly_status = "Готово";
    copy.assembly_responsible = "Майстер Збірки";
    copy.ready_date = uaDate(-1);
  }
  return enrichPositionRow(copy, { planDate: uaDate(5) });
}

async function nextPositionId(client) {
  const { rows } = await client.query("SELECT COALESCE(MAX(id), 1000) + 1 AS id FROM positions");
  return Number(rows[0].id);
}

async function insertPosition(client, row) {
  const cols = POSITION_BASE_COLUMNS;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const values = cols.map((col) => row[col]);
  await client.query(`INSERT INTO positions (${cols.join(", ")}) VALUES (${placeholders})`, values);
}

async function insertOrder(client, payload) {
  const { rows } = await client.query(
    `INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, order_number`,
    [
      payload.orderNumber,
      payload.object,
      payload.client,
      payload.manager,
      payload.startDate,
      payload.planDate,
      payload.status,
      payload.priority,
      payload.comment
    ]
  );
  return rows[0];
}

async function runDemo(client) {
  const suffix = Date.now().toString().slice(-6);

  const activeOrder = await insertOrder(client, {
    orderNumber: `DEMO-FLOW-${suffix}`,
    object: "Демо об'єкт — повний цикл ролей",
    client: "Демо клієнт",
    manager: "Менеджер Демо",
    startDate: uaDate(-2),
    planDate: uaDate(5),
    status: "У виробництві",
    priority: "Середній",
    comment: "Автогенерація демо по всіх ролях"
  });

  let id = await nextPositionId(client);
  const variants = [
    ["constructor", "Позиція 1 · Конструктив"],
    ["cutting", "Позиція 2 · Порізка"],
    ["edging", "Позиція 3 · Крайкування"],
    ["drilling", "Позиція 4 · Присадка"],
    ["assembly", "Позиція 5 · Збірка"],
    ["readyInstall", "Позиція 6 · Готово до монтажу"]
  ];

  for (const [variant, item] of variants) {
    const base = makePositionBase({
      id,
      orderId: activeOrder.id,
      orderNumber: activeOrder.order_number,
      object: "Демо об'єкт — повний цикл ролей",
      item,
      manager: "Менеджер Демо"
    });
    await insertPosition(client, stagePosition(base, variant));
    id += 1;
  }

  const archivedOrder = await insertOrder(client, {
    orderNumber: `DEMO-ARCHIVE-${suffix}`,
    object: "Демо архівний проєкт",
    client: "Архівний клієнт",
    manager: "Менеджер Демо",
    startDate: uaDate(-14),
    planDate: uaDate(-2),
    status: DONE_ORDER_STATUS,
    priority: "Середній",
    comment: "Повністю завершено, має бути тільки в архіві"
  });

  const archivedBase = makePositionBase({
    id,
    orderId: archivedOrder.id,
    orderNumber: archivedOrder.order_number,
    object: "Демо архівний проєкт",
    item: "Архівна позиція",
    manager: "Менеджер Демо"
  });
  const archivedReady = stagePosition(archivedBase, "readyInstall");
  archivedReady.position_status = "Завершено";
  archivedReady.progress = 100;
  archivedReady.install_date = uaDate(-3);
  archivedReady.install_end_date = uaDate(-2);
  archivedReady.install_responsible = "Бригада Архів";
  archivedReady.overdue_days = 0;
  await insertPosition(client, archivedReady);

  console.log(`Демо створено: ${activeOrder.order_number}, ${archivedOrder.order_number}`);
}

const cs = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!cs) {
  console.error("Потрібно задати DATABASE_URL_MIGRATIONS або DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: cs });
client
  .connect()
  .then(() => runDemo(client))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
