import { parseUaDate } from "../dates/ua-date.js";

/**
 * Евристична оцінка дедлайну конструктора з урахуванням типу виробу,
 * файлів менеджера, строку замовлення та завантаження.
 */
export function suggestConstructorTiming(position = {}, context = {}) {
  const item = String(position.item || "").toLowerCase();
  const itemType = String(position.itemType || position.item_type || "").toLowerCase();
  const childCount = Number(context.childCount) || 0;
  const managerFilesCount =
    Number(context.managerFilesCount ?? position.managerFilesCount ?? position.manager_files_count) || 0;
  const pdfCount = Number(context.managerPdfCount) || 0;
  const photoCount = Number(context.managerPhotoCount) || 0;
  const applianceCount = Number(context.applianceCount) || 0;
  const orderPlanDate = String(
    context.orderPlanDate || position.orderPlanDate || position.order_plan_date || ""
  ).trim();
  const positionDeadline = String(
    position.positionDeadline ||
      position.position_deadline ||
      context.positionDeadline ||
      ""
  ).trim();

  let hours = 4;
  let complexity = "normal";
  const reasons = [];

  if (itemType.includes("кухн") || item.includes("кухн")) {
    hours = 16;
    complexity = "high";
    reasons.push("кухня — багато блоків");
  } else if (itemType.includes("шаф") || item.includes("шаф")) {
    hours = 8;
    complexity = "medium";
    reasons.push("шафа");
  } else if (itemType.includes("стіл") || item.includes("стіл")) {
    hours = 3;
    complexity = "low";
  }

  if (childCount > 0) {
    hours += Math.min(childCount, 8) * 1.5;
    reasons.push(`${childCount} підпоз.`);
  }

  if (managerFilesCount > 0) {
    hours *= 0.92;
    reasons.push(`${managerFilesCount} файл. менеджера`);
  } else {
    hours *= 1.15;
    reasons.push("немає файлів менеджера");
  }

  if (pdfCount >= 2) {
    hours *= 0.9;
    reasons.push("є PDF");
  }
  if (photoCount >= 3) {
    hours *= 0.95;
    reasons.push("багато фото");
  }
  if (applianceCount > 0) {
    hours += applianceCount * 0.5;
    reasons.push("посилання на техніку");
  }

  if (position.hasConstructiveFile || position.has_constructive_file) {
    hours *= 0.75;
    reasons.push("є попередній конструктив");
  }

  const constructorLoad = Number(context.constructorOpenPositions) || 0;
  if (constructorLoad >= 5) {
    hours *= 1.2;
    reasons.push("конструктор завантажений");
  }

  hours = Math.round(hours * 10) / 10;

  const now = context.now instanceof Date ? context.now : new Date();
  let due = new Date(now);
  due.setDate(due.getDate() + Math.max(1, Math.ceil(hours / 8)));

  const deadlineUa = parseUaDate(positionDeadline) || parseUaDate(orderPlanDate);
  if (deadlineUa) {
    const daysToDeadline = Math.ceil((deadlineUa.getTime() - now.getTime()) / 86400000);
    if (daysToDeadline > 0 && daysToDeadline < 30) {
      reasons.push(`строк замовлення через ${daysToDeadline} дн.`);
      const cap = new Date(now);
      cap.setDate(cap.getDate() + Math.max(1, daysToDeadline - 2));
      if (cap < due) due = cap;
    }
  }

  const riskLevel =
    complexity === "high" && managerFilesCount < 2
      ? "high"
      : managerFilesCount === 0
        ? "medium"
        : "low";

  return {
    estimatedHours: hours,
    dueAt: due.toISOString(),
    complexity,
    riskLevel,
    recommendedDueAt: due.toISOString(),
    rationale: reasons.length
      ? reasons.join(", ")
      : `Базова оцінка за типом «${position.itemType || position.item || "виріб"}»`,
    reason: reasons.join("; ")
  };
}
