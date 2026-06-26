import { TABS, ATTENTION_TAB, PRODUCTION_FLOOR_TAB } from "./constants.js";
import { ORDER_DONE_STATUS } from "./archive.js";

/** Маршрути з огляду / дашборду → вкладка + опційні фільтри. */
export const DASHBOARD_NAV_ROUTES = {
  "У фокусі": { tab: ATTENTION_TAB },
  [ATTENTION_TAB]: { tab: ATTENTION_TAB },
  Прострочки: { tab: ATTENTION_TAB },
  Проблеми: { tab: ATTENTION_TAB },
  "У виробництві": { tab: "Замовлення", ordersDisplayMode: "positions", status: "У виробництві" },
  "До монтажу": {
    tab: "Замовлення",
    ordersDisplayMode: "positions",
    status: "Готово до встановлення"
  },
  Позиції: { tab: "Замовлення", ordersDisplayMode: "positions" },
  Архів: { tab: "Замовлення", status: ORDER_DONE_STATUS, archived: true },
  [PRODUCTION_FLOOR_TAB]: { tab: PRODUCTION_FLOOR_TAB },
  /** Зворотна сумісність зі старими підписами в UI */
  "Виробництво за етапами": { tab: PRODUCTION_FLOOR_TAB }
};

export function resolveDashboardNav(destination) {
  const route = DASHBOARD_NAV_ROUTES[destination];
  if (route) return { ...route };
  if (TABS.includes(destination)) return { tab: destination };
  return { tab: destination };
}
