/** Єдине джерело правди для етапів і статусів (server + client). */

export const STAGE_STATUSES = [
  "Не розпочато",
  "Передано",
  "В роботі",
  "На паузі",
  "Готово",
  "Проблема",
  "Не потрібно"
];

export const POSITION_STATUSES = [
  "Не розпочато",
  "Передано",
  "У виробництві",
  "Готово до встановлення",
  "На паузі",
  "Проблема",
  "Завершено"
];

export const STAGE_STATUS_DONE = new Set(["Готово", "Не потрібно"]);

export const STAGE_ACTIVE_STATUSES = new Set(["Передано", "В роботі", "На паузі", "Проблема"]);

/** Ваги етапів виробництва (сума 100). Конструктив і монтаж не входять. */
export const PRODUCTION_PROGRESS_WEIGHTS = {
  cutting: 20,
  edging: 25,
  drilling: 25,
  assembly: 30
};

export const OPERATOR_STAGES = [
  { key: "cutting", label: "Порізка", icon: "🪚" },
  { key: "edging", label: "Крайкування", icon: "📏" },
  { key: "drilling", label: "Присадка", icon: "🕳" },
  { key: "assembly", label: "Збірка", icon: "🔧" }
];

export const ALL_STAGE_KEYS = OPERATOR_STAGES.map((s) => s.key);

export const STAGE_STATUS_FIELD = {
  cutting: "cutting_status",
  edging: "edging_status",
  drilling: "drilling_status",
  assembly: "assembly_status"
};

export const STAGES = [
  { key: "constructor", label: "Конструктив", icon: "📐", type: "constructor" },
  {
    key: "cutting",
    label: "Порізка",
    icon: "🪚",
    field: "cuttingStatus",
    dbField: "cutting_status",
    defaultResponsible: "Віяр"
  },
  {
    key: "edging",
    label: "Крайкування",
    icon: "📏",
    field: "edgingStatus",
    dbField: "edging_status",
    defaultResponsible: "Віяр"
  },
  {
    key: "drilling",
    label: "Присадка",
    icon: "🕳",
    field: "drillingStatus",
    dbField: "drilling_status"
  },
  {
    key: "assembly",
    label: "Збірка",
    icon: "🔧",
    field: "assemblyStatus",
    dbField: "assembly_status",
    usesAssembler: true
  },
  { key: "install", label: "Монтаж", icon: "🏠", type: "install" }
];

export const STAGE_PATCH_MAP = {
  constructor: { type: "constructor" },
  cutting: { field: "cutting_status" },
  edging: { field: "edging_status" },
  drilling: { field: "drilling_status" },
  assembly: { field: "assembly_status" },
  install: { field: "install_status" }
};

export const HANDOFF_CHAIN = {
  constructor: "cutting",
  cutting: "edging",
  edging: "drilling",
  drilling: "assembly"
};

export const NEXT_STAGE_FIELD = {
  cutting: "edging_status",
  edging: "drilling_status",
  drilling: "assembly_status"
};

const NEXT_STATUS = {
  "Не розпочато": "Передано",
  Передано: "В роботі",
  "В роботі": "Готово",
  Готово: "Готово",
  "На паузі": "В роботі",
  Проблема: "В роботі",
  "Не потрібно": "Не потрібно"
};

export function getNextStatus(current) {
  return NEXT_STATUS[current] || "Передано";
}

export function stageStatusClass(status) {
  const map = {
    "Не розпочато": "stage-idle",
    Передано: "stage-handoff",
    "В роботі": "stage-active",
    Готово: "stage-done",
    "На паузі": "stage-pause",
    Проблема: "stage-problem",
    "Не потрібно": "stage-skip"
  };
  return map[status] || "stage-idle";
}

export function isStageIdle(status) {
  return !status || status === "Не розпочато";
}
