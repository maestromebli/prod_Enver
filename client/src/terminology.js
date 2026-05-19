/** Єдині назви етапів і UI — одне джерело правди. */
export const STAGES = [
  { key: "constructor", tab: "Конструктив", label: "Конструктив", operatorLabel: "Конструктив" },
  { key: "cutting", tab: "Порізка", label: "Порізка", operatorLabel: "Порізка" },
  { key: "edging", tab: "Крайкування", label: "Крайкування", operatorLabel: "Крайкування" },
  { key: "drilling", tab: "Присадка", label: "Присадка", operatorLabel: "Присадка" },
  { key: "assembly", tab: "Збірка", label: "Збірка", operatorLabel: "Збірка" }
];

export const STAGE_TABS = STAGES.map((s) => s.tab);

export const STAGE_TAB_KEYS = Object.fromEntries(STAGES.map((s) => [s.tab, s.key]));

export const STAGE_STATUS_FIELD = {
  cutting: "cuttingStatus",
  edging: "edgingStatus",
  drilling: "drillingStatus",
  assembly: "assemblyStatus"
};

export const BRAND = {
  name: "ENVER",
  tagline: "Виробничий контроль замовлень",
  city: "Київ · меблі на замовлення"
};
