/**
 * Розширення godmode для pipeline пакета конструктива.
 */
import {
  canCreateProcurementFromContext,
  isPackagePipelineBlocking,
  isProcurementRequestActive,
  packageStatusLabel,
  procurementStatusLabel
} from "./constructive-package.js";

const PACKAGE_ACTIONS = {
  uploaded: {
    type: "parse_constructive_package",
    label: "Розібрати пакет конструктива",
    buttonLabel: "Розібрати"
  },
  parsing: {
    type: "wait_parse",
    label: "Розбір пакета…",
    buttonLabel: "Зачекайте",
    allowed: false
  },
  parsed: {
    type: "review_constructive",
    label: "Перевірити конструктив",
    buttonLabel: "Перевірити"
  },
  needs_review: {
    type: "review_constructive",
    label: "Перевірити конструктив",
    buttonLabel: "Перевірити"
  },
  rejected: {
    type: "upload_constructive_package",
    label: "Завантажити новий пакет конструктива",
    buttonLabel: "Завантажити"
  }
};

/** Якщо є пакет — повертає nextAction для pipeline, інакше null. */
export function getConstructivePackageNextAction(context = {}) {
  const status = context.packageStatus;
  if (!status || !isPackagePipelineBlocking(status)) return null;

  const cfg = PACKAGE_ACTIONS[status];
  if (!cfg) return null;

  return {
    type: cfg.type,
    label: cfg.label,
    description: `Пакет конструктива: ${packageStatusLabel(status)}.`,
    buttonLabel: cfg.buttonLabel,
    priority: status === "rejected" || status === "needs_review" ? "high" : "normal",
    allowed: cfg.allowed !== false,
    reason: cfg.allowed === false ? cfg.label : null,
    stageKey: "constructor"
  };
}

export function getConstructivePackageWarnings(context = {}) {
  const warnings = [];
  if (context.packageStatus === "rejected") {
    warnings.push({
      type: "constructive_rejected",
      level: "warning",
      title: "Конструктив відхилено",
      message: context.rejectedReason || "Потрібно завантажити новий пакет."
    });
  }
  if (context.unmappedPartsCount > 0) {
    warnings.push({
      type: "unmapped_3d_parts",
      level: "warning",
      title: "Деталі без 3D",
      message: `${context.unmappedPartsCount} деталей не звʼязані з 3D-моделлю.`
    });
  }
  if (context.packageStatus === "uploaded") {
    warnings.push({
      type: "package_not_parsed",
      level: "warning",
      title: "Пакет не розібрано",
      message: "Запустіть розбір пакета конструктива."
    });
  }
  return warnings;
}

/** Наступна дія закупівлі після погодження пакета (паралельно з виробництвом). */
export function getConstructiveProcurementNextAction(context = {}) {
  const status = String(context.packageStatus || "").trim();
  if (!status || isPackagePipelineBlocking(status) || status === "procurement_done") {
    return null;
  }

  const procStatus = String(context.procurementStatus ?? context.procurement?.status ?? "").trim();
  const hasRequest = Boolean(
    context.hasProcurementRequest ?? (procStatus && isProcurementRequestActive(procStatus))
  );

  if (hasRequest && isProcurementRequestActive(procStatus)) {
    return {
      type: "wait_procurement",
      label: `Закупівля: ${procurementStatusLabel(procStatus)}`,
      description: "Обробіть заявку — погодження, замовлення у постачальника, приймання на склад.",
      buttonLabel: "Відкрити закупівлю",
      priority: ["draft", "waiting_approval", "ordered", "partially_received"].includes(procStatus)
        ? "high"
        : "normal",
      allowed: true,
      stageKey: "constructor"
    };
  }

  if (canCreateProcurementFromContext(context)) {
    return {
      type: "create_procurement",
      label: "Передати в закупівлю",
      description: "Створіть заявку з Excel-специфікації конструктора (матеріали та фурнітура).",
      buttonLabel: "В закупівлю",
      priority: "high",
      allowed: true,
      stageKey: "constructor"
    };
  }

  return null;
}
