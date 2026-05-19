export const ROLES = {
  admin: "admin",
  manager: "manager",
  production: "production",
  operator: "operator"
};

export const OPERATOR_STAGES = [
  { key: "cutting", label: "Порізка" },
  { key: "edging", label: "Крайкування" },
  { key: "drilling", label: "Присадка" },
  { key: "assembly", label: "Збірка" }
];

export const ALL_STAGE_KEYS = OPERATOR_STAGES.map((s) => s.key);

export const STAGE_STATUS_FIELD = {
  cutting: "cutting_status",
  edging: "edging_status",
  drilling: "drilling_status",
  assembly: "assembly_status"
};

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
