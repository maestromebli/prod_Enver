/**
 * Розширення godmode для pipeline пакета конструктива.
 */
import { isPackagePipelineBlocking, packageStatusLabel } from "./constructive-package.js";

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
