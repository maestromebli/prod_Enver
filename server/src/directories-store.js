import { db } from "./db.js";

export const DEFAULT_DIRECTORIES = {
  Менеджери: ["Ігор", "Макс", "Андрій", "Олег", "Максим", "Люда", "Сергій"],
  Конструктори: ["Ігор", "Олег", "Макс", "Андрій", "Максим", "Сергій", "Тарас"],
  Збирачі: ["Андрій", "Назар", "Кузя", "Вадим", "Саша", "Назар Саша", "Саша Назар"],
  Монтажники: ["Андрій", "Кузя", "Саша", "Вадим", "Назар Саша"],
  "Статуси етапів": ["Не розпочато", "Передано", "В роботі", "Готово", "На паузі", "Проблема", "Не потрібно"],
  "Статуси замовлення": [
    "Новий",
    "У конструктиві",
    "Передано у виробництво",
    "У виробництві",
    "Частково готово",
    "Готово до встановлення",
    "На встановленні",
    "Завершено",
    "Пауза за клієнтом",
    "Проблема"
  ],
  "Типи виробів": [
    "Кухня",
    "Шафа",
    "Гардеробна",
    "Санвузол",
    "Панелі",
    "Тумба",
    "ТВ-зона",
    "Спальня",
    "Дитяча",
    "Інше"
  ],
  Пріоритети: ["Високий", "Звичайний", "Низький"]
};

let getStmt;
let upsertStmt;

function stmts() {
  if (!getStmt) {
    getStmt = db.prepare("SELECT value_json FROM app_settings WHERE key = 'directories'");
    upsertStmt = db.prepare(`
      INSERT INTO app_settings (key, value_json) VALUES ('directories', @value_json)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `);
  }
  return { getStmt, upsertStmt };
}

export function getDirectories() {
  const row = stmts().getStmt.get();
  if (!row?.value_json) return { ...DEFAULT_DIRECTORIES };
  try {
    return { ...DEFAULT_DIRECTORIES, ...JSON.parse(row.value_json) };
  } catch {
    return { ...DEFAULT_DIRECTORIES };
  }
}

export function saveDirectories(data) {
  const merged = { ...getDirectories(), ...data };
  stmts().upsertStmt.run({ value_json: JSON.stringify(merged) });
  return merged;
}

export function seedDirectoriesIfEmpty() {
  const { getStmt, upsertStmt } = stmts();
  const row = getStmt.get();
  if (row) return;
  upsertStmt.run({ value_json: JSON.stringify(DEFAULT_DIRECTORIES) });
}
