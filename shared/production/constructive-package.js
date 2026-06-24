/** Статуси та константи пакета конструктива (server + client). */

export const PACKAGE_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "needs_review",
  "approved_by_constructor",
  "approved_by_production",
  "sent_to_procurement",
  "procurement_done",
  "finance_ready",
  "cnc_ready",
  "sent_to_gitlab",
  "released_to_cnc",
  "archived",
  "rejected"
];

export const PACKAGE_FILE_KINDS = [
  "spec_xls",
  "project",
  "b3d",
  "assembly_pdf",
  "cnc_file",
  "glb_model",
  "gltf_model",
  "preview_image",
  "other"
];

export const PROCUREMENT_STATUSES = [
  "draft",
  "waiting_approval",
  "approved",
  "ordered",
  "partially_received",
  "received",
  "rejected",
  "cancelled"
];

export const PROCUREMENT_ITEM_TYPES = [
  "board",
  "edge",
  "hardware",
  "accessory",
  "service",
  "other"
];

export const FINANCE_ENTRY_TYPES = [
  "material_cost",
  "hardware_cost",
  "cnc_cost",
  "labor_cost",
  "delivery_cost",
  "installation_cost",
  "other"
];

export const CNC_JOB_STATUSES = [
  "waiting",
  "ready",
  "sent_to_gitlab",
  "at_machine",
  "in_progress",
  "paused",
  "done",
  "problem",
  "cancelled"
];

export const PART_CNC_STATUSES = [
  "waiting",
  "ready",
  "at_machine",
  "in_progress",
  "done",
  "problem"
];

export const SCAN_ACTIONS = [
  "viewed_3d",
  "started_cnc",
  "finished_cnc",
  "problem_reported",
  "quality_checked",
  "manual_lookup"
];

export const CNC_PROBLEM_REASONS = [
  "Не знайдено файл ЧПК",
  "Не відповідає розмір",
  "Не той матеріал",
  "Не читається штрихкод",
  "Деталь не знайдена в 3D",
  "Помилка програми",
  "Пошкодження",
  "Інше"
];

export const PROCUREMENT_STATUS_LABELS = {
  draft: "Чернетка",
  waiting_approval: "Очікує погодження",
  approved: "Погоджено",
  ordered: "Замовлено",
  partially_received: "Частково отримано",
  received: "Отримано",
  rejected: "Відхилено",
  cancelled: "Скасовано"
};

export function procurementStatusLabel(status) {
  return PROCUREMENT_STATUS_LABELS[status] || status || "—";
}

export const CNC_JOB_STATUS_LABELS = {
  waiting: "Очікує",
  ready: "Готово",
  sent_to_gitlab: "У GitLab",
  at_machine: "На верстаті",
  in_progress: "В роботі",
  paused: "Пауза",
  done: "Готово",
  problem: "Проблема",
  cancelled: "Скасовано"
};

export function cncJobStatusLabel(status) {
  return CNC_JOB_STATUS_LABELS[status] || status || "—";
}

/** Людські підписи статусів пакета. */
export const PACKAGE_STATUS_LABELS = {
  uploaded: "Завантажено",
  parsing: "Розбір…",
  parsed: "Розібрано",
  needs_review: "Потрібна перевірка",
  approved_by_constructor: "Підтверджено конструктором",
  approved_by_production: "Підтверджено виробництвом",
  sent_to_procurement: "Передано в закупівлю",
  procurement_done: "Закупівля завершена",
  finance_ready: "Готово до фінансів",
  cnc_ready: "Готово до ЧПК",
  sent_to_gitlab: "Відправлено в GitLab",
  released_to_cnc: "Передано на верстат",
  archived: "Архів",
  rejected: "Відхилено"
};

export const PACKAGE_FILE_KIND_LABELS = {
  spec_xls: "Специфікація XLS",
  project: "Project",
  b3d: "B3D",
  assembly_pdf: "Складальне креслення PDF",
  cnc_file: "ЧПК файл",
  glb_model: "GLB модель",
  gltf_model: "GLTF модель",
  preview_image: "Preview",
  other: "Інше"
};

/** Pipeline кроки для UI. */
export const CONSTRUCTIVE_PIPELINE_STEPS = [
  { key: "files", label: "Файли", statuses: ["uploaded"] },
  { key: "parse", label: "Розбір", statuses: ["parsing", "parsed"] },
  { key: "procurement", label: "Закупівля", statuses: ["sent_to_procurement", "procurement_done"] },
  { key: "finance", label: "Фінанси", statuses: ["finance_ready"] },
  {
    key: "review",
    label: "Перевірка",
    statuses: ["needs_review", "approved_by_constructor", "approved_by_production"]
  },
  { key: "gitlab", label: "GitLab", statuses: ["cnc_ready", "sent_to_gitlab"] },
  { key: "cnc", label: "ЧПК", statuses: ["released_to_cnc"] },
  { key: "labels", label: "Етикетки", statuses: [] },
  { key: "production", label: "Виробництво", statuses: [] }
];

export function packageStatusLabel(status) {
  return PACKAGE_STATUS_LABELS[status] || status || "—";
}

/** Визначити kind файлу за розширенням. */
export function detectPackageFileKind(fileName) {
  const n = String(fileName || "").toLowerCase();
  if (n.endsWith(".xls") || n.endsWith(".xlsx")) return "spec_xls";
  if (n.endsWith(".project")) return "project";
  if (n.endsWith(".b3d")) return "b3d";
  if (n.endsWith(".pdf")) return "assembly_pdf";
  if (n.endsWith(".glb")) return "glb_model";
  if (n.endsWith(".gltf")) return "gltf_model";
  if (/\.(png|jpg|jpeg|webp)$/i.test(n)) return "preview_image";
  if (/\.(nc|gcode|tap|cnc|kdt|giblab)$/i.test(n)) return "cnc_file";
  return "other";
}

/** Чи пакет дозволяє відправку в GitLab. */
export function canSendToGitlab(status) {
  return [
    "approved_by_constructor",
    "approved_by_production",
    "cnc_ready",
    "sent_to_gitlab"
  ].includes(status);
}

/** Чи пакет пройшов approval для ЧПК. */
export function isPackageApprovedForCnc(status) {
  return [
    "approved_by_constructor",
    "approved_by_production",
    "cnc_ready",
    "sent_to_gitlab",
    "released_to_cnc"
  ].includes(status);
}
