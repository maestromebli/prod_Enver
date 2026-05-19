import { one, run } from "./db.js";

export const DEFAULT_DIRECTORIES = {
  Менеджери: ["Ігор", "Макс", "Андрій", "Олег", "Максим", "Люда", "Сергій"],
  Конструктори: ["Ігор", "Олег", "Макс", "Андрій", "Максим", "Сергій", "Тарас"],
  Збирачі: ["Андрій", "Назар", "Кузя", "Вадим", "Саша", "Назар Саша", "Саша Назар"],
  Монтажники: ["Андрій", "Кузя", "Саша", "Вадим", "Назар Саша"],
  "Статуси етапів": [
    "Не розпочато",
    "Передано",
    "В роботі",
    "Готово",
    "На паузі",
    "Проблема",
    "Не потрібно"
  ],
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

export async function getDirectories() {
  const row = await one("SELECT value_json FROM app_settings WHERE key = 'directories'");
  if (!row?.value_json) return { ...DEFAULT_DIRECTORIES };
  try {
    return { ...DEFAULT_DIRECTORIES, ...JSON.parse(row.value_json) };
  } catch {
    return { ...DEFAULT_DIRECTORIES };
  }
}

export async function saveDirectories(data) {
  const merged = { ...(await getDirectories()), ...data };
  await run(
    `INSERT INTO app_settings (key, value_json) VALUES ('directories', $1)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    [JSON.stringify(merged)]
  );
  return merged;
}
