import { parseJson } from "./json-utils.js";

export const LED_VOLTAGES = ["220", "24", "12"];

export const WORKSPACE_FILE_KINDS = {
  tech: "Техніка (кухня)",
  measurements: "Заміри",
  manager_image: "Картинка від менеджера",
  custom: "Інший файл"
};

export function defaultWorkspacePayload(position = {}) {
  const itemType = String(position.itemType || position.item_type || "").toLowerCase();
  const item = String(position.item || "").toLowerCase();
  const isKitchen = itemType.includes("кухн") || item.includes("кухн");
  return {
    isKitchen,
    techLink: "",
    ledLighting: {
      voltage: "",
      color: "",
      profile: "",
      controller: "",
      notes: ""
    },
    customLinks: []
  };
}

export function parseWorkspaceJson(raw, position = {}) {
  const base = defaultWorkspacePayload(position);
  const parsed = parseJson(raw, {});
  if (!parsed || typeof parsed !== "object") return base;
  return {
    ...base,
    ...parsed,
    ledLighting: { ...base.ledLighting, ...(parsed.ledLighting || {}) },
    customLinks: Array.isArray(parsed.customLinks) ? parsed.customLinks : base.customLinks
  };
}

export function isKitchenWorkspace(workspace, position = {}) {
  if (workspace?.isKitchen) return true;
  const itemType = String(position.itemType || position.item_type || "").toLowerCase();
  const item = String(position.item || "").toLowerCase();
  return itemType.includes("кухн") || item.includes("кухн");
}

export function validateWorkspacePayload(workspace, position = {}) {
  const errors = [];
  const led = workspace?.ledLighting || {};
  if (!String(led.voltage || "").trim()) {
    errors.push("LED підсвітка: оберіть напругу (220, 24 або 12 В)");
  } else if (!LED_VOLTAGES.includes(String(led.voltage))) {
    errors.push("LED підсвітка: некоректна напруга");
  }
  if (!String(led.color || "").trim()) {
    errors.push("LED підсвітка: вкажіть колір");
  }
  if (isKitchenWorkspace(workspace, position)) {
    const hasTech =
      String(workspace?.techLink || "").trim() ||
      (workspace?.files || []).some((f) => f.kind === "tech");
    if (!hasTech) {
      errors.push("Для кухні потрібна техніка: посилання або файл");
    }
  }
  return errors;
}

export function workspaceCompletion(workspace, files = []) {
  const led = workspace?.ledLighting || {};
  const ledOk = Boolean(String(led.voltage || "").trim() && String(led.color || "").trim());
  const measurementsOk = files.some((f) => f.kind === "measurements");
  const managerImageOk = files.some((f) => f.kind === "manager_image");
  const techOk =
    !isKitchenWorkspace(workspace) ||
    Boolean(String(workspace?.techLink || "").trim()) ||
    files.some((f) => f.kind === "tech");
  const score = [ledOk, measurementsOk, managerImageOk, techOk].filter(Boolean).length;
  return { ledOk, measurementsOk, managerImageOk, techOk, percent: Math.round((score / 4) * 100) };
}

export function suggestConstructorTiming(position = {}, childCount = 0) {
  const item = String(position.item || "").toLowerCase();
  const itemType = String(position.itemType || position.item_type || "").toLowerCase();
  let hours = 4;
  if (itemType.includes("кухн") || item.includes("кухн")) hours = 16;
  else if (itemType.includes("шаф") || item.includes("шаф")) hours = 8;
  else if (itemType.includes("стіл") || item.includes("стіл")) hours = 3;
  hours += Math.min(childCount, 8) * 1.5;
  if (position.hasConstructiveFile || position.has_constructive_file) hours *= 0.75;
  hours = Math.round(hours * 10) / 10;
  const due = new Date();
  due.setDate(due.getDate() + Math.max(1, Math.ceil(hours / 8)));
  return {
    estimatedHours: hours,
    dueAt: due.toISOString(),
    rationale: `Базова оцінка за типом «${position.itemType || position.item || "виріб"}»${childCount ? ` + ${childCount} підпоз.` : ""}`
  };
}
