import {
  ALL_STAGE_KEYS,
  OPERATOR_STAGES,
  STAGE_STATUS_FIELD
} from "../../shared/production/stages.js";

export const ROLES = {
  admin: "admin",
  manager: "manager",
  production: "production",
  operator: "operator"
};

export { OPERATOR_STAGES, ALL_STAGE_KEYS, STAGE_STATUS_FIELD };

export const DEFAULT_PERMISSIONS = {
  admin: {
    canViewSettings: true,
    canManageUsers: true,
    canManageAccess: true,
    canEditOrders: true,
    canEditPositions: true,
    canUseOperatorPanel: true,
    canViewMachineLogs: true,
    canViewProductionFloor: true,
    stages: ALL_STAGE_KEYS
  },
  manager: {
    canViewSettings: false,
    canManageUsers: false,
    canManageAccess: false,
    canEditOrders: true,
    canEditPositions: true,
    canUseOperatorPanel: false,
    canViewMachineLogs: false,
    canViewProductionFloor: false,
    stages: []
  },
  production: {
    canViewSettings: false,
    canManageUsers: false,
    canManageAccess: false,
    canEditOrders: true,
    canEditPositions: true,
    canUseOperatorPanel: true,
    canViewMachineLogs: true,
    canViewProductionFloor: true,
    stages: ALL_STAGE_KEYS
  },
  operator: {
    canViewSettings: false,
    canManageUsers: false,
    canManageAccess: false,
    canEditOrders: false,
    canEditPositions: false,
    canUseOperatorPanel: true,
    canViewMachineLogs: false,
    canViewProductionFloor: false,
    stages: []
  }
};
