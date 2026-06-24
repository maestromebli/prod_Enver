import { OPERATOR_STAGES } from "@enver/shared/production/stages.js";
import { UI_ROLES } from "@enver/shared/production/permissions.js";

export { OPERATOR_STAGES };
export const ROLES = UI_ROLES;

export const PRODUCTION_FLOOR_TAB = "Цех зараз";
export const CONSTRUCTOR_DESK_TAB = "Конструктори";

export function stageLabel(key) {
  return OPERATOR_STAGES.find((s) => s.key === key)?.label || key;
}
