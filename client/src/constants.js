import { PRODUCTION_FLOOR_TAB, CONSTRUCTOR_DESK_TAB, PROCUREMENT_TAB } from "./users-constants.js";

export { PRODUCTION_FLOOR_TAB, CONSTRUCTOR_DESK_TAB, PROCUREMENT_TAB };

/** Спрощена навігація ENVER v3 */
export const OVERVIEW_TAB = "Огляд";
export const ATTENTION_TAB = "Потребує уваги";
export const TABS = [
  OVERVIEW_TAB,
  "Замовлення",
  ATTENTION_TAB,
  PRODUCTION_FLOOR_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB,
  "Встановлення",
  "Історія змін"
];
