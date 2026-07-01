/** Статуси та константи пакета конструктива (server + client). */

import { normalizeBazisScanCode } from "./bazis-operation-code.js";

export const PACKAGE_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "needs_review",
  "approved_by_constructor",
  "approved_by_production",
  "sent_to_procurement",
  "procurement_done",
  "cnc_ready",
  "sent_to_cnc",
  "released_to_cnc",
  "archived",
  "rejected"
];

/** Після цього часу статус parsing вважається завислим (сервер скидає на uploaded). */
export const PACKAGE_PARSING_STALE_MS = 90_000;

export const PACKAGE_FILE_KINDS = [
  "spec_xls",
  "project",
  "b3d",
  "assembly_pdf",
  "cnc_file",
  "glb_model",
  "gltf_model",
  "wrl_model",
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

export const CNC_JOB_STATUSES = [
  "waiting",
  "ready",
  "sent_to_cnc",
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

/** Дозволені переходи статусів закупівлі (лінійний pipeline). */
export const PROCUREMENT_ADVANCE = {
  draft: "waiting_approval",
  waiting_approval: "approved",
  approved: "ordered",
  ordered: "partially_received",
  partially_received: "received"
};

const TERMINAL_PROCUREMENT_STATUSES = new Set(["received", "rejected", "cancelled"]);

export function nextProcurementStatus(current) {
  return PROCUREMENT_ADVANCE[current] || null;
}

export function canAdvanceProcurementStatus(current) {
  return Boolean(PROCUREMENT_ADVANCE[current]);
}

/** Перевірка переходу статусу закупівлі (rejected/cancelled — з будь-якого активного). */
export function isValidProcurementStatusTransition(from, to) {
  if (!to || from === to) return true;
  if (to === "rejected" || to === "cancelled") {
    return !TERMINAL_PROCUREMENT_STATUSES.has(from);
  }
  return PROCUREMENT_ADVANCE[from] === to;
}

export function procurementAdvanceButtonLabel(current) {
  if (current === "ordered") return "Частково отримано";
  if (current === "partially_received") return "Отримано";
  const next = nextProcurementStatus(current);
  return next ? procurementStatusLabel(next) : null;
}

export const CNC_JOB_STATUS_LABELS = {
  waiting: "Очікує",
  ready: "Готово",
  sent_to_cnc: "У черзі ЧПК",
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
  cnc_ready: "Готово до ЧПК",
  sent_to_cnc: "Відправлено на ЧПК",
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
  wrl_model: "VRML модель (.wrl)",
  preview_image: "Preview",
  other: "Інше"
};

/** Статуси, поки пакет ще не готовий до передачі в чергу порізки. */
export const PACKAGE_PRE_PRODUCTION_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "needs_review",
  "rejected"
];

export function isPackagePipelineBlocking(status) {
  return PACKAGE_PRE_PRODUCTION_STATUSES.includes(status);
}

/** Статуси пакета, коли можна передати позицію в чергу порізки. */
export const PACKAGE_HANDOFF_TO_CUTTING_STATUSES = [
  "approved_by_constructor",
  "approved_by_production",
  "sent_to_procurement",
  "procurement_done",
  "cnc_ready",
  "sent_to_cnc",
  "released_to_cnc"
];

export function canHandoffPackageToCutting(context = {}, row = {}) {
  const status = String(
    context.packageStatus ?? row.constructive_package_status ?? row.constructivePackageStatus ?? ""
  ).trim();
  return Boolean(status && PACKAGE_HANDOFF_TO_CUTTING_STATUSES.includes(status));
}

/** Перевірка перед передачею позиції на порізку (без привʼязки до черги godmode). */
export function validateHandoffToCutting(row = {}, context = {}) {
  const pkgStatus = String(
    context.packageStatus ?? row.constructive_package_status ?? row.constructivePackageStatus ?? ""
  ).trim();
  const hasPackage = Boolean(
    context.hasConstructivePackage ?? row.has_constructive_package ?? row.hasConstructivePackage
  );
  const partsCount =
    Number(
      context.constructivePartsCount ?? row.constructive_parts_count ?? row.constructivePartsCount
    ) || 0;
  const hasConstructiveData =
    Boolean(row.has_constructive_file ?? row.hasConstructiveFile) || hasPackage || partsCount > 0;

  if (!hasConstructiveData) {
    return { ok: false, error: "Потрібно завантажити конструктив." };
  }

  const cutting = String(row.cutting_status ?? row.cuttingStatus ?? "Не розпочато").trim();
  if (cutting && !["Не розпочато", "Передано"].includes(cutting)) {
    return { ok: false, error: `Порізка вже має статус «${cutting}».` };
  }

  if (hasPackage || pkgStatus) {
    if (!pkgStatus || isPackagePipelineBlocking(pkgStatus)) {
      return { ok: false, error: "Спочатку підтвердіть пакет конструктива." };
    }
  }

  return { ok: true };
}

/** Pipeline кроки для UI (основний ланцюг конструктива; закупівля — окремо). */
export const CONSTRUCTIVE_PIPELINE_STEPS = [
  { key: "files", label: "Файли", statuses: ["uploaded"] },
  { key: "parse", label: "Розбір", statuses: ["parsing", "parsed"] },
  { key: "review", label: "Перевірка", statuses: ["needs_review"] },
  {
    key: "approved",
    label: "Погоджено",
    statuses: ["approved_by_constructor", "approved_by_production"]
  },
  {
    key: "production",
    label: "Порізка",
    statuses: [
      "sent_to_procurement",
      "procurement_done",
      "cnc_ready",
      "sent_to_cnc",
      "released_to_cnc"
    ]
  }
];

/** Пакет підтверджено — можна передавати на порізку. */
export function isPackageApprovedStatus(status) {
  return ["approved_by_constructor", "approved_by_production"].includes(
    String(status || "").trim()
  );
}

export function packageStatusLabel(status) {
  return PACKAGE_STATUS_LABELS[status] || status || "—";
}

/** Пакет ще не розібрано (лише файли завантажено). */
export function isPackageNotParsedStatus(status) {
  return String(status || "").trim() === "uploaded";
}

/** Йде розбір пакета. */
export function isPackageParsingStatus(status) {
  return String(status || "").trim() === "parsing";
}

/** Чи завис розбір (немає активного процесу на сервері). */
export function isStalePackageParsing(pkg) {
  if (!pkg || !isPackageParsingStatus(pkg.status)) return false;
  const raw = pkg.updatedAt ?? pkg.updated_at;
  if (!raw) return true;
  const age = Date.now() - new Date(raw).getTime();
  return !Number.isFinite(age) || age > PACKAGE_PARSING_STALE_MS;
}

/** Пакет уже розібрано (є деталі / наступні етапи). */
export function isPackageParsedStatus(status) {
  const s = String(status || "").trim();
  if (!s || isPackageNotParsedStatus(s) || isPackageParsingStatus(s) || s === "rejected") {
    return false;
  }
  return true;
}

/** Заголовок для банера розбору в UI. */
export function packageParseDisplay(status, partsCount = 0) {
  const s = String(status || "uploaded").trim();
  if (isPackageParsingStatus(s)) {
    return {
      parsed: false,
      parsing: true,
      stale: false,
      title: "Розбір пакета",
      subtitle: "Обробляємо файли конструктива…"
    };
  }
  if (isPackageNotParsedStatus(s)) {
    return {
      parsed: false,
      parsing: false,
      title: "Не розібрано",
      subtitle: "Завантажте файли і натисніть «Розібрати»"
    };
  }
  if (isPackageParsedStatus(s)) {
    const n = Number(partsCount) || 0;
    return {
      parsed: true,
      parsing: false,
      title: "Розібрано",
      subtitle: n ? `${n} деталей у специфікації` : packageStatusLabel(s)
    };
  }
  return {
    parsed: false,
    parsing: false,
    title: packageStatusLabel(s),
    subtitle: ""
  };
}

/** Індекс активного кроку pipeline за статусом пакета. */
export function constructivePipelineStepIndex(status) {
  const s = String(status || "uploaded");
  for (let i = CONSTRUCTIVE_PIPELINE_STEPS.length - 1; i >= 0; i--) {
    if (CONSTRUCTIVE_PIPELINE_STEPS[i].statuses.includes(s)) return i;
  }
  return 0;
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
  if (n.endsWith(".wrl")) return "wrl_model";
  if (/\.(png|jpg|jpeg|webp)$/i.test(n)) return "preview_image";
  if (/\.(nc|gcode|tap|cnc|kdt|giblab)$/i.test(n)) return "cnc_file";
  return "other";
}

/** Чи пакет можна передати на верстат (після підтвердження перевірки). */
export function canReleasePackageToCnc(status) {
  return [
    "approved_by_constructor",
    "approved_by_production",
    "sent_to_procurement",
    "procurement_done",
    "cnc_ready",
    "sent_to_cnc"
  ].includes(status);
}

/** Чи пакет пройшов перевірку для ЧПК. */
export function isPackageApprovedForCnc(status) {
  return [
    "approved_by_constructor",
    "approved_by_production",
    "sent_to_procurement",
    "procurement_done",
    "cnc_ready",
    "sent_to_cnc",
    "released_to_cnc"
  ].includes(status);
}

/** Файли конструктора — джерело 3D та специфікації (не ЧПК-програми). */
export const CONSTRUCTOR_PACKAGE_FILE_KINDS = [
  "spec_xls",
  "project",
  "b3d",
  "assembly_pdf",
  "glb_model",
  "gltf_model",
  "wrl_model",
  "preview_image"
];

/** Файли для верстата / ЧПК. */
export const CNC_MACHINE_PACKAGE_FILE_KINDS = ["cnc_file"];

/** Джерела мапінгу 3D: конструкторський .project + GibLab .b3d. */
export const MODEL_MAPPING_SOURCE_KINDS = ["project", "b3d"];

export function isModelMappingSourceKind(kind) {
  return MODEL_MAPPING_SOURCE_KINDS.includes(kind);
}

export function isConstructorPackageFileKind(kind) {
  return CONSTRUCTOR_PACKAGE_FILE_KINDS.includes(kind);
}

export function isCncMachinePackageFileKind(kind) {
  return CNC_MACHINE_PACKAGE_FILE_KINDS.includes(kind);
}

/** Розділяє файли пакета: мапінг 3D, специфікація, ЧПК. */
export function partitionModelMappingSources(files = []) {
  const project = [];
  const b3d = [];
  const specification = [];
  const cncMachine = [];
  const other = [];
  for (const f of files) {
    const kind = f.kind || detectPackageFileKind(f.originalName || f.fileName || "");
    const row = { ...f, kind };
    if (kind === "project") project.push(row);
    else if (kind === "b3d") b3d.push(row);
    else if (isCncMachinePackageFileKind(kind)) cncMachine.push(row);
    else if (isConstructorPackageFileKind(kind)) specification.push(row);
    else other.push(row);
  }
  return { project, b3d, specification, cncMachine, other };
}

/** Розділяє файли пакета за роллю для мапінгу 3D. */
export function partitionPackageFilesByRole(files = []) {
  const { project, b3d, specification, cncMachine, other } = partitionModelMappingSources(files);
  const constructor = [...project, ...b3d, ...specification];
  return { constructor, cncMachine, other, project, b3d, specification };
}

/** Чи є обидва джерела мапінгу 3D: .project + .b3d. */
export function hasModelMappingSources(detail) {
  const files = detail?.files || [];
  const hasProject = files.some((f) => f.kind === "project");
  const hasB3d = files.some((f) => f.kind === "b3d");
  return hasProject && hasB3d;
}

/** Чи є в пакеті .project і GibLab .b3d для створення мапінгу 3D. */
export function canCreateModelMapping(detail) {
  return hasModelMappingSources(detail);
}

/** Кількість деталей зі звʼязком 3D / без звʼязку. */
export function countMappedParts(detail) {
  const parts = detail?.parts || [];
  const mapped = parts.filter((p) => p.modelNodeId || p.modelMeshName).length;
  return { total: parts.length, mapped, unmapped: parts.length - mapped };
}

/** Чи вже є звʼязки деталей з 3D. */
export function hasModelMappingResult(detail) {
  return countMappedParts(detail).mapped > 0;
}

export const PREVIEW_3D_FILE_KINDS = ["glb_model", "gltf_model", "wrl_model"];

export function isPreview3dFileKind(kind) {
  return PREVIEW_3D_FILE_KINDS.includes(kind);
}

/** Чи є GLB/GLTF/VRML для перегляду 3D (авто з .b3d або завантажений). */
export function has3dPreviewFile(detail) {
  return (detail?.files || []).some((f) => isPreview3dFileKind(f.kind));
}

export const AUTO_PREVIEW_GLB_NAME = "3d-preview.glb";

function packageFileName(file) {
  return file?.originalName || file?.original_name || "";
}

function packageFilePreviewLayout(file) {
  return file?.previewLayout || file?.preview_layout || null;
}

/** Автогенерований GLB (плоска розкладка панелей). */
export function isAutoGeneratedPreviewGlb(file) {
  return packageFileName(file) === AUTO_PREVIEW_GLB_NAME;
}

/** GLB/VRML збірки, завантажені користувачем (не автопревʼю з .b3d). */
export function isUserUploadedAssemblyGlb(detail) {
  return (detail?.files || []).some(
    (f) =>
      f.kind === "wrl_model" ||
      ((f.kind === "glb_model" || f.kind === "gltf_model") && !isAutoGeneratedPreviewGlb(f))
  );
}

/** Файл для перегляду 3D: користувацький GLB/VRML або автопревʼю з .b3d. */
export function findPackagePreview3dFile(detail) {
  const files = (detail?.files || []).filter((f) => isPreview3dFileKind(f.kind));
  return (
    files.find((f) => isPreview3dFileKind(f.kind) && !isAutoGeneratedPreviewGlb(f)) ||
    files.find((f) => isAutoGeneratedPreviewGlb(f)) ||
    null
  );
}

export function preview3dLoadFormat(file) {
  if (file?.kind === "wrl_model") return "wrl";
  return "glb";
}

/** `assembly` — повна збірка; `flat` — розкладка деталей. */
export function preview3dLayout(detail) {
  if (!has3dPreviewFile(detail)) return null;
  if (isUserUploadedAssemblyGlb(detail)) return "assembly";
  const autoGlb = (detail?.files || []).find((f) => isAutoGeneratedPreviewGlb(f));
  if (packageFilePreviewLayout(autoGlb) === "assembly") return "assembly";
  return "flat";
}

export function preview3dLayoutLabel(layout) {
  if (layout === "assembly") return "3D-збірка";
  if (layout === "flat") return "Розкладка деталей";
  return "Перегляд 3D";
}

/** Чи є .b3d як джерело 3D-моделі. */
export function hasB3dSourceFile(detail) {
  return (detail?.files || []).some((f) => f.kind === "b3d");
}

/** Статуси, коли можна доповнити пакет новими файлами (не створювати нову версію). */
export const PACKAGE_APPEND_FILE_STATUSES = ["uploaded", "parsed", "needs_review", "parsing"];

export function canAppendFilesToPackage(status) {
  return PACKAGE_APPEND_FILE_STATUSES.includes(status);
}

export function hasProjectMappingFile(files = []) {
  return files.some((f) => f.kind === "project");
}

export function hasB3dMappingFile(files = []) {
  return files.some((f) => f.kind === "b3d");
}

/** Чи в пакеті лише один файл з пари .project + .b3d — чекаємо другий перед розбором. */
export function shouldDeferParseForMappingPair(detail) {
  const files = detail?.files || [];
  const hasProject = hasProjectMappingFile(files);
  const hasB3d = hasB3dMappingFile(files);
  return (hasProject && !hasB3d) || (hasB3d && !hasProject);
}

/** Доповнити існуючий пакет другим файлом мапінгу замість створення нової версії. */
export function shouldComplementMappingPackage(detail, incomingKinds = []) {
  if (!detail?.package?.id) return false;
  const files = detail?.files || [];
  const hasProject = hasProjectMappingFile(files);
  const hasB3d = hasB3dMappingFile(files);
  const addsProject = incomingKinds.includes("project");
  const addsB3d = incomingKinds.includes("b3d");
  if (!hasProject && hasB3d && addsProject) return true;
  if (hasProject && !hasB3d && addsB3d) return true;
  return false;
}

/**
 * Розірвана пара .project / .b3d у різних версіях пакета (після старого бага).
 * Повертає, який файл скопіювати в цільовий пакет (вища version).
 */
export function findSplitMappingPackages(packages = []) {
  if (!Array.isArray(packages) || packages.length < 2) return null;

  let soloProject = null;
  let soloB3d = null;

  for (const entry of packages) {
    const pkg = entry.package || entry;
    const files = entry.files || [];
    const hasProject = hasProjectMappingFile(files);
    const hasB3d = hasB3dMappingFile(files);
    if (hasProject && hasB3d) return null;
    if (hasProject && !hasB3d && !soloProject) {
      soloProject = { package: pkg, files };
    }
    if (hasB3d && !hasProject && !soloB3d) {
      soloB3d = { package: pkg, files };
    }
  }

  if (!soloProject || !soloB3d) return null;
  const projectPkg = soloProject.package;
  const b3dPkg = soloB3d.package;
  if (!projectPkg?.id || !b3dPkg?.id || projectPkg.id === b3dPkg.id) return null;

  const target =
    Number(projectPkg.version || 0) >= Number(b3dPkg.version || 0) ? soloProject : soloB3d;
  const source = target === soloProject ? soloB3d : soloProject;
  const missingKind = target === soloProject ? "b3d" : "project";
  const fileToCopy = source.files.find((f) => f.kind === missingKind);
  if (!fileToCopy?.id) return null;

  return {
    targetPackageId: target.package.id,
    sourcePackageId: source.package.id,
    fileId: fileToCopy.id,
    missingKind
  };
}

/** Пакет для доповнення другим файлом мапінгу (перший з найвищої версії). */
export function pickComplementMappingPackage(packages = [], incomingKinds = []) {
  for (const entry of packages) {
    const pkg = entry.package || entry;
    const detail = entry.detail || { package: pkg, files: entry.files || [] };
    if (shouldComplementMappingPackage(detail, incomingKinds)) {
      return pkg;
    }
  }
  return null;
}

/** Показувати вкладку «Мапінг 3D», коли є .project + .b3d або вже є звʼязки деталей. */
export function shouldShowModelMappingTab(detail) {
  if (hasModelMappingResult(detail)) return true;
  return canCreateModelMapping(detail);
}

/** Чи пакет очікує розбору для мапінгу 3D (.project + .b3d завантажено, деталей ще немає). */
export function needsParseForModelMapping(detail) {
  if (!canCreateModelMapping(detail)) return false;
  return !detail?.parts?.length;
}

/** Чи достатньо файлів і пакет ще не розібрано — запускати автоматичний розбір і мапінг. */
export function canAutoParsePackageForMapping(detail) {
  if (!canCreateModelMapping(detail)) return false;
  const status = detail?.package?.status ?? detail?.status ?? "";
  return status === "uploaded";
}

/** Чи запускати автоматичний розбір після завантаження (XLS, .project+.b3d). Застаріло на сервері — розбір лише вручну. */
export function canAutoParsePackage(detail) {
  const status = detail?.package?.status ?? detail?.status ?? "";
  if (status !== "uploaded") return false;
  if (shouldDeferParseForMappingPair(detail)) return false;
  if (canCreateModelMapping(detail)) return true;
  const files = detail?.files || [];
  if (files.some((f) => f.kind === "spec_xls" || f.kind === "assembly_pdf")) return true;
  return false;
}

/** Статуси пакета, коли можна створити закупівлю з XLS конструктора. */
export const PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES = [
  "parsed",
  "needs_review",
  "approved_by_constructor",
  "approved_by_production",
  "sent_to_procurement",
  "procurement_done",
  "cnc_ready",
  "sent_to_cnc",
  "released_to_cnc"
];

/** Чи є джерело закупівлі — XLS специфікація конструктора (не ЧПК). */
export function hasConstructorProcurementSource(detail) {
  const files = detail?.files || [];
  const hasXls = files.some((f) => f.kind === "spec_xls");
  const materials = detail?.materials || [];
  const hardware = detail?.hardware || [];
  return hasXls && (materials.length > 0 || hardware.length > 0);
}

/** Прибирає суфікс «мм» і зайві пробіли з числового поля розміру. */
export function stripMmUnit(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s*мм\s*/gi, "")
    .trim();
}

/** Нормалізує числове поле розміру до цілого мм. */
export function formatMmNumber(value) {
  const stripped = stripMmUnit(value);
  if (!stripped) return "";
  const n = Number(String(stripped).replace(",", "."));
  if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  return stripped;
}

/** Розміри деталі з .project — L×W [×T] у міліметрах. */
export function formatPartDimensionsMm(part = {}) {
  const length = formatMmNumber(part.length);
  const width = formatMmNumber(part.width);
  const thickness = formatMmNumber(part.thickness);
  if (!length || !width) return "—";
  const dims = [length, width];
  if (thickness) dims.push(thickness);
  return `${dims.join("×")} мм`;
}

/** Масштабує локальні розміри mesh з урахуванням world scale (до перетворення в мм). */
export function scaleLocalMeshExtents(localExtents = [], worldScale = []) {
  const local = Array.isArray(localExtents) ? localExtents : [];
  const scale = Array.isArray(worldScale) ? worldScale : [];
  return local
    .map((value, index) => Number(value) * Math.abs(Number(scale[index] ?? 1)))
    .filter((v) => Number.isFinite(v) && v > 0);
}

/**
 * Розміри bounding box mesh у мм.
 * @param {number[]} sizes — розміри в локальних осях mesh (після world scale), не world AABB
 * @param {{ preferMm?: boolean | null }} options — preferMm з detectSceneExtentsPreferMm
 */
export function formatMeshBoundingBoxMm(sizes = [], { preferMm = null } = {}) {
  const raw = (Array.isArray(sizes) ? sizes : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!raw.length) return "";
  const scaleToMm =
    preferMm === true ? 1 : preferMm === false ? 1000 : Math.max(...raw) > 50 ? 1 : 1000;
  const dims = raw.map((v) => Math.round(v * scaleToMm)).sort((a, b) => b - a);
  return dims.length ? `${dims.join("×")} мм` : "";
}

/** Чи модель уже в мм (VRML Базіс) чи в метрах (наш GLB). */
export function detectSceneExtentsPreferMm(extents = []) {
  const raw = (Array.isArray(extents) ? extents : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!raw.length) return null;
  return Math.max(...raw) > 50;
}

/** Нормалізує номер деталі для зіставлення (10 === 010). */
export function normalizePartNoKey(value) {
  const t = String(value ?? "").trim();
  if (!t) return "";
  if (/^\d+$/.test(t)) return String(Number(t));
  return t;
}

function addLookupKey(keys, value) {
  const v = String(value ?? "").trim();
  if (!v) return;
  keys.add(v);
  keys.add(v.toLowerCase());
  const norm = normalizePartNoKey(v);
  if (norm) {
    keys.add(norm);
    keys.add(norm.toLowerCase());
  }
}

/** Ключі імені mesh для зіставлення з деталлю (panel-10, B1-21, …). */
export function meshNameLookupKeys(meshName) {
  const keys = new Set();
  const s = String(meshName || "").trim();
  if (!s) return keys;
  addLookupKey(keys, s);

  const bare = s.replace(/^panel-/i, "");
  if (bare !== s) addLookupKey(keys, bare);

  const noZeros = s.replace(/^0+/, "") || s;
  if (noZeros !== s) addLookupKey(keys, noZeros);

  const blockPart = bare.match(/^([BVБ]\d+)-(\d+)$/i);
  if (blockPart) {
    addLookupKey(keys, blockPart[0]);
    addLookupKey(keys, blockPart[2]);
  }

  // Код операції Bazis (0010X002X1) — лише повне імʼя, без «хвостового» номера.
  if (!/X/i.test(s)) {
    if (/^\d{1,6}$/.test(bare)) {
      addLookupKey(keys, bare);
    } else {
      const dashed = bare.match(/-(\d{1,6})$/);
      if (dashed) addLookupKey(keys, dashed[1]);
    }
  }

  return keys;
}

/** Усі ключі деталі каталогу для зіставлення з mesh. */
export function partCatalogLookupKeys(part = {}) {
  const keys = new Set();
  const add = (value) => {
    for (const key of meshNameLookupKeys(value)) keys.add(key);
  };

  add(part.modelMeshName);
  add(part.modelNodeId);

  const blockCode = String(part.blockCode || part.block_code || "").trim();
  const partNo = String(part.partNo || part.part_no || "").trim();
  const partCode = String(part.partCode || part.part_code || part.code || "").trim();
  if (blockCode && partNo) add(`${blockCode}-${partNo}`);
  if (partNo) add(partNo);
  if (partCode) add(partCode);

  const opCodes = part.bazisOperationCodes || part.bazis_operation_codes || [];
  for (const raw of opCodes) {
    const code = normalizeBazisScanCode(raw);
    if (code) add(code);
  }

  return keys;
}

function lookupKeysIntersect(meshKeys, partKeys) {
  for (const key of meshKeys) {
    if (partKeys.has(key)) return key;
    const lower = key.toLowerCase();
    if (partKeys.has(lower)) return lower;
  }
  return "";
}

/** Знайти деталь каталогу за іменем mesh у 3D-моделі. */
export function resolvePartByMeshName(meshName, parts = []) {
  if (!parts.length) return null;
  const meshKeys = meshNameLookupKeys(meshName);
  if (!meshKeys.size) return null;

  let best = null;
  let bestScore = 0;

  for (const part of parts) {
    const partKeys = partCatalogLookupKeys(part);
    const hit = lookupKeysIntersect(meshKeys, partKeys);
    if (!hit) continue;

    let score = hit.length;
    if (part.modelMeshName && meshKeys.has(String(part.modelMeshName).trim())) score += 100;
    if (part.modelNodeId && meshKeys.has(String(part.modelNodeId).trim())) score += 100;
    if (hit.includes("-")) score += 20;
    if (/X/i.test(hit)) score += 15;

    if (score > bestScore) {
      bestScore = score;
      best = part;
    }
  }

  return best;
}

/** Зібрати всі імена вузлів mesh (сам mesh + батьки). */
export function collectMeshNodeNames(mesh) {
  const names = [];
  let node = mesh;
  while (node) {
    if (node.name) names.push(node.name);
    node = node.parent;
  }
  return names;
}

/** Знайти деталь за Three.js mesh (перебір імен вузлів). */
export function resolvePartByMesh(mesh, parts = []) {
  if (!mesh) return null;
  for (const name of collectMeshNodeNames(mesh)) {
    const part = resolvePartByMeshName(name, parts);
    if (part) return part;
  }
  return null;
}

/** Заголовок і підпис для панелі вибраної деталі в 3D. */
export function formatPartPickerInfo(part, { meshName = "", sizeLabel = "" } = {}) {
  const blockCode = String(part?.blockCode || "").trim();
  const partNo = String(part?.partNo || "").trim();
  const partName = String(part?.partName || "").trim();
  const material = String(part?.material || "").trim();

  let numberLine = "";
  if (blockCode && partNo) numberLine = `${blockCode} · №${partNo}`;
  else if (partNo) numberLine = `№${partNo}`;
  else if (meshName) numberLine = `№${meshName.replace(/^panel-/i, "")}`;

  const catalogDims = part ? formatPartDimensionsMm(part) : "—";
  const dims = catalogDims !== "—" ? catalogDims : sizeLabel || "—";

  return {
    numberLine: numberLine || "—",
    name: partName || "Деталь",
    dimensions: dims,
    material: material || ""
  };
}

/** Чи можна створити закупівлю з розбору XLS (без привʼязки до ЧПК). */
export function canCreateProcurement(detail) {
  const status = detail?.package?.status ?? "";
  if (!PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES.includes(status)) return false;
  if (detail?.procurement?.id) return false;
  return hasConstructorProcurementSource(detail);
}

/** Статуси пакета, з яких можна передати в закупівлю. */
export const PACKAGE_SEND_TO_PROCUREMENT_STATUSES = [
  "parsed",
  "needs_review",
  "approved_by_constructor",
  "approved_by_production"
];

const TERMINAL_PROCUREMENT_REQUEST_STATUSES = new Set(["received", "rejected", "cancelled"]);

export function isProcurementRequestActive(status) {
  const s = String(status || "").trim();
  return Boolean(s && !TERMINAL_PROCUREMENT_REQUEST_STATUSES.has(s));
}

/** Чи можна створити закупівлю за контекстом godmode (без повного detail). */
export function canCreateProcurementFromContext(context = {}) {
  const status = String(context.packageStatus ?? context.package?.status ?? "").trim();
  if (!PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES.includes(status)) return false;
  if (context.hasProcurementRequest || context.procurement?.id) return false;
  return Boolean(context.hasProcurementSource);
}

export function canMarkPackageSentToProcurement(status) {
  return PACKAGE_SEND_TO_PROCUREMENT_STATUSES.includes(String(status || "").trim());
}
