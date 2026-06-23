import { ALL_STAGE_KEYS } from "./stages.js";

export const UI_ROLES = [
  { id: "admin", label: "Адміністратор" },
  { id: "production", label: "Начальник виробництва" },
  { id: "manager", label: "Менеджер (продажі)" },
  { id: "operator", label: "Оператор" }
];

export const DEFAULT_PERMISSIONS = {
  admin: {
    canViewSettings: true,
    canManageUsers: true,
    canManageAccess: true,
    canEditOrders: true,
    canEditPositions: true,
    canUseOperatorPanel: true,
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
    canViewProductionFloor: false,
    stages: []
  }
};
