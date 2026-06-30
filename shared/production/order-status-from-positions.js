/**
 * Виведення статусу замовлення з робочих позицій (зворотна синхронізація).
 */
import { getWorkPositions } from "./order-position-model.js";
import { STAGE_ACTIVE_STATUSES, STAGE_STATUS_DONE } from "./stages.js";

/** Ранг для forward-only оновлення (вищий = далі в pipeline). */
export const ORDER_STATUS_RANK = {
  "": 0,
  Новий: 1,
  "У конструктиві": 2,
  "Передано у виробництво": 3,
  "У виробництві": 4,
  "Частково готово": 5,
  "Готово до встановлення": 6,
  "На встановленні": 7,
  Завершено: 8
};

const FROZEN_ORDER_STATUSES = new Set(["Пауза за клієнтом"]);

function positionStatus(row) {
  return String(row?.position_status ?? row?.positionStatus ?? "").trim();
}

function hasConstructorAssigned(row) {
  if (row?.constructor_user_id != null) return true;
  return Boolean(String(row?.constructor_name ?? row?.constructorName ?? "").trim());
}

function isInProduction(row) {
  const ps = positionStatus(row);
  if (["У виробництві", "Готово до встановлення", "На встановленні", "Завершено"].includes(ps)) {
    return true;
  }
  const fields = ["cutting_status", "edging_status", "drilling_status", "assembly_status"];
  const camel = ["cuttingStatus", "edgingStatus", "drillingStatus", "assemblyStatus"];
  for (let i = 0; i < fields.length; i++) {
    const status = String(row?.[fields[i]] ?? row?.[camel[i]] ?? "").trim();
    if (STAGE_ACTIVE_STATUSES.has(status) || STAGE_STATUS_DONE.has(status)) return true;
  }
  return false;
}

function hasInstallScheduled(row) {
  return Boolean(String(row?.install_date ?? row?.installDate ?? "").trim());
}

/**
 * Обчислює статус замовлення за робочими позиціями.
 * @returns {string|null} null — не змінювати
 */
export function deriveOrderStatusFromPositions(order, positions = []) {
  const work = getWorkPositions(order, positions);
  if (!work.length) return null;

  if (work.some((p) => String(p?.problem ?? "").trim())) return "Проблема";

  const statuses = work.map(positionStatus).filter(Boolean);
  if (statuses.length && statuses.every((s) => s === "Завершено")) return "Завершено";

  if (work.some((p) => positionStatus(p) === "На встановленні" || hasInstallScheduled(p))) {
    return "На встановленні";
  }

  const readyCount = work.filter((p) => positionStatus(p) === "Готово до встановлення").length;
  if (readyCount === work.length) return "Готово до встановлення";
  if (readyCount > 0) return "Частково готово";

  if (work.some(isInProduction)) return "У виробництві";

  if (work.every(hasConstructorAssigned)) return "У конструктиві";

  return null;
}

/** Чи варто оновити статус замовлення на derived (лише вперед, окрім Проблема). */
export function shouldUpdateOrderStatus(currentStatus, derivedStatus) {
  const current = String(currentStatus || "").trim();
  const derived = String(derivedStatus || "").trim();
  if (!derived) return false;
  if (FROZEN_ORDER_STATUSES.has(current)) return false;
  if (derived === "Проблема") return current !== "Проблема";
  const rank = (s) => ORDER_STATUS_RANK[s] ?? (s === "Проблема" ? 0 : -1);
  if (current === "Проблема" && rank(derived) >= rank("У виробництві")) return true;
  return rank(derived) > rank(current);
}
