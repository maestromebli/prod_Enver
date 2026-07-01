/** Константи 3D-простору ENVER (production tablet / CAD). */

/** @typedef {'exact' | 'fallback' | 'ambiguous' | 'missing'} MappingStatus */

/** @typedef {'waiting' | 'ready' | 'in_progress' | 'finished' | 'problem' | 'skipped' | 'missing_material'} ProductionPartStatus */

/** @typedef {'product' | 'scan' | 'detail' | 'drawing' | 'assembly' | 'control'} Enver3dMode */

export const MAPPING_STATUS_LABELS = {
  exact: "3D звʼязано",
  fallback: "Резервна звʼязка — перевірте",
  ambiguous: "Є кілька можливих деталей — потрібна перевірка",
  missing: "Деталь не звʼязана з 3D"
};

export const MAPPING_STATUS_CSS = {
  exact: "enver-3d-badge--exact",
  fallback: "enver-3d-badge--fallback",
  ambiguous: "enver-3d-badge--ambiguous",
  missing: "enver-3d-badge--missing"
};

export const PRODUCTION_STATUS_COLORS = {
  waiting: null,
  ready: 0x22c55e,
  in_progress: 0x3b82f6,
  finished: 0x16a34a,
  problem: 0xef4444,
  skipped: 0xf97316,
  missing_material: 0xa855f7
};

export const CAMERA_PRESET_IDS = ["iso", "top", "bottom", "front", "back", "left", "right"];

export const DIAGNOSTICS_READINESS_API = {
  Готово: "ready",
  "Потрібна перевірка": "needs_review",
  "Не готово": "not_ready"
};
