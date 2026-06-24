/**
 * Розширення godmode для pipeline пакета конструктива.
 */
import { packageStatusLabel } from "./constructive-package.js";

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
    type: "create_procurement",
    label: "Створити закупівлю з конструктива",
    buttonLabel: "Закупівля"
  },
  needs_review: {
    type: "review_constructive",
    label: "Перевірити конструктив",
    buttonLabel: "Перевірити"
  },
  sent_to_procurement: {
    type: "wait_procurement",
    label: "Очікує закупівлю",
    buttonLabel: "Закупівля",
    allowed: false
  },
  procurement_done: {
    type: "review_constructive",
    label: "Перевірити конструктив",
    buttonLabel: "Перевірити"
  },
  finance_ready: {
    type: "review_constructive",
    label: "Перевірити конструктив",
    buttonLabel: "Перевірити"
  },
  approved_by_constructor: {
    type: "send_to_gitlab",
    label: "Відправити в GitLab / ЧПК",
    buttonLabel: "GitLab"
  },
  approved_by_production: {
    type: "send_to_gitlab",
    label: "Відправити в GitLab / ЧПК",
    buttonLabel: "GitLab"
  },
  cnc_ready: {
    type: "send_to_gitlab",
    label: "Відправити в GitLab / ЧПК",
    buttonLabel: "GitLab"
  },
  sent_to_gitlab: {
    type: "print_part_labels",
    label: "Надрукувати етикетки деталей",
    buttonLabel: "Етикетки"
  },
  released_to_cnc: {
    type: "handoff_to_cutting",
    label: "Передати на виробництво",
    buttonLabel: "Передати"
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
  if (!status) return null;

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
