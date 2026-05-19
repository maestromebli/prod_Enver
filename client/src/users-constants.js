export const OPERATOR_STAGES = [
  { key: "cutting", label: "Порізка", tab: "Порізка" },
  { key: "edging", label: "Крайкування", tab: "Крайкування" },
  { key: "drilling", label: "Присадка", tab: "Присадка" },
  { key: "assembly", label: "Збірка", tab: "Збірка" }
];

export const ROLES = [
  { id: "admin", label: "Адміністратор" },
  { id: "production", label: "Начальник виробництва" },
  { id: "manager", label: "Менеджер (продажі)" },
  { id: "operator", label: "Оператор" }
];

export const PRODUCTION_FLOOR_TAB = "Цех зараз";

export function stageLabel(key) {
  return OPERATOR_STAGES.find((s) => s.key === key)?.label || key;
}
