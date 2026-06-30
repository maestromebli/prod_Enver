/** Пресети видимості колонок реєстру позицій. */

export const POSITIONS_COLUMN_PRESETS = {
  manager: {
    label: "Менеджер",
    hint: "Клієнт, терміни, статус"
  },
  floor: {
    label: "Цех",
    hint: "Етапи виробництва"
  },
  full: {
    label: "Повний",
    hint: "Усі колонки"
  }
};

export const DEFAULT_POSITIONS_COLUMN_PRESET = "manager";

const VALID_PRESETS = new Set(Object.keys(POSITIONS_COLUMN_PRESETS));

export function normalizePositionsColumnPreset(value) {
  return VALID_PRESETS.has(value) ? value : DEFAULT_POSITIONS_COLUMN_PRESET;
}

export function positionsColumnPresetClass(preset) {
  return `positions-view--cols-${normalizePositionsColumnPreset(preset)}`;
}

export function renderPositionsColumnPresetBar(activePreset) {
  const preset = normalizePositionsColumnPreset(activePreset);
  const buttons = Object.entries(POSITIONS_COLUMN_PRESETS)
    .map(
      ([key, meta]) =>
        `<button type="button" class="positions-col-preset-btn ${preset === key ? "active" : ""}" data-pos-cols="${key}" title="${meta.hint}" aria-pressed="${preset === key}">${meta.label}</button>`
    )
    .join("");
  return `<div class="positions-col-preset-bar" role="group" aria-label="Колонки таблиці">${buttons}</div>`;
}
