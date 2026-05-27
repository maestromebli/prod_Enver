import { PRODUCTION_FLOOR_TAB } from "./users-constants.js";
import { STAGE_TABS } from "./terminology.js";

export { STAGE_TABS, PRODUCTION_FLOOR_TAB };

export const TABS = [
  "Дашборд",
  "Архів",
  PRODUCTION_FLOOR_TAB,
  "Замовлення",
  "Позиції замовлення",
  "Виробництво за етапами",
  ...STAGE_TABS,
  "Встановлення",
  "Прострочки",
  "Історія змін"
];
