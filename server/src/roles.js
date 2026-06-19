import {
  ALL_STAGE_KEYS,
  OPERATOR_STAGES,
  OPERATOR_STAGE_KEY_SET,
  STAGE_STATUS_FIELD
} from "../../shared/production/stages.js";
import { DEFAULT_PERMISSIONS } from "../../shared/production/permissions.js";

export const ROLES = {
  admin: "admin",
  manager: "manager",
  production: "production",
  operator: "operator"
};

export {
  OPERATOR_STAGES,
  ALL_STAGE_KEYS,
  STAGE_STATUS_FIELD,
  OPERATOR_STAGE_KEY_SET,
  DEFAULT_PERMISSIONS
};
