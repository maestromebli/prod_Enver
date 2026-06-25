import { parseJson } from "./json-utils.js";
import { getPositionRequirements } from "../../shared/production/position-manager-data.js";

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
  const { needsTech, needsLed } = getPositionRequirements(position);

  if (needsLed) {
    const led = workspace?.ledLighting || {};
    if (!String(led.voltage || "").trim()) {
      errors.push("LED підсвітка: оберіть напругу (220, 24 або 12 В)");
    } else if (!LED_VOLTAGES.includes(String(led.voltage))) {
      errors.push("LED підсвітка: некоректна напруга");
    }
    if (!String(led.color || "").trim()) {
      errors.push("LED підсвітка: вкажіть колір");
    }
  }

  if (needsTech) {
    const hasTech =
      String(workspace?.techLink || "").trim() ||
      (workspace?.files || []).some((f) => f.kind === "tech");
    if (!hasTech) {
      errors.push("Потрібна техніка: додайте посилання або файл");
    }
  }

  return errors;
}

export function workspaceCompletion(workspace, files = [], position = {}) {
  const { needsTech, needsLed } = getPositionRequirements(position);
  const led = workspace?.ledLighting || {};
  const ledOk =
    !needsLed || Boolean(String(led.voltage || "").trim() && String(led.color || "").trim());
  const measurementsOk = files.some((f) => f.kind === "measurements");
  const managerImageOk = files.some((f) => f.kind === "manager_image");
  const techOk =
    !needsTech ||
    Boolean(String(workspace?.techLink || "").trim()) ||
    files.some((f) => f.kind === "tech");

  const checks = [measurementsOk, managerImageOk];
  if (needsLed) checks.push(ledOk);
  if (needsTech) checks.push(techOk);
  const score = checks.filter(Boolean).length;

  return {
    needsTech,
    needsLed,
    ledOk: needsLed ? ledOk : null,
    techOk: needsTech ? techOk : null,
    measurementsOk,
    managerImageOk,
    percent: checks.length ? Math.round((score / checks.length) * 100) : 100
  };
}

export { suggestConstructorTiming } from "../../shared/production/constructor-timing.js";
