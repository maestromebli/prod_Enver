import { db } from "./db.js";

const REPLACEMENTS = [
  ["В работе", "В роботі"],
  ["В производстве", "У виробництві"],
  ["Готово к установке", "Готово до встановлення"],
  ["Готов к установке", "Готово до встановлення"],
  ["Завершён", "Завершено"],
  ["На паузе", "На паузі"],
  ["Не начато", "Не розпочато"],
  ["Не требуется", "Не потрібно"],
  ["Высокий", "Високий"],
  ["Обычный", "Звичайний"],
  ["Низкий", "Низький"],
  ["Частное лицо", "Приватна особа"],
  ["Новый", "Новий"],
  ["В конструктиве", "У конструктиві"],
  ["Передан в производство", "Передано у виробництво"],
  ["Частично готов", "Частково готово"],
  ["На установке", "На встановленні"],
  ["Пауза по клиенту", "Пауза за клієнтом"],
  ["Корпусная мебель", "Корпусні меблі"],
  ["Панели / Тумба", "Панелі / Тумба"],
  ["Зависла присадка", "Застрягла присадка"],
  ["Сборка / Производство", "Збірка / Виробництво"]
];

const TEXT_COLUMNS = {
  orders: ["status", "priority", "client"],
  positions: [
    "cutting_status",
    "edging_status",
    "drilling_status",
    "assembly_status",
    "position_status",
    "item_type",
    "problem"
  ]
};

export function migrateToUkrainian() {
  const run = db.transaction(() => {
    for (const [from, to] of REPLACEMENTS) {
      for (const [table, columns] of Object.entries(TEXT_COLUMNS)) {
        for (const column of columns) {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from);
        }
      }
    }
  });
  run();
}
