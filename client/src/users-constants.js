export const OPERATOR_STAGES = [
  { key: "cutting", label: "Порізка", tab: "Порізка" },
  { key: "edging", label: "Крайкування", tab: "Крайкування" },
  { key: "drilling", label: "Присадка", tab: "Присадка" },
  { key: "assembly", label: "Збірка", tab: "Збірка" }
];

export const ROLES = [
  { id: "admin", label: "Адміністратор" },
  { id: "manager", label: "Менеджер" },
  { id: "operator", label: "Оператор" }
];

export function stageLabel(key) {
  return OPERATOR_STAGES.find((s) => s.key === key)?.label || key;
}
