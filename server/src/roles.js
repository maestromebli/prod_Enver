export const ROLES = {
  admin: "admin",
  manager: "manager",
  operator: "operator"
};

export const OPERATOR_STAGES = [
  { key: "cutting", label: "Порізка" },
  { key: "edging", label: "Крайкування" },
  { key: "drilling", label: "Присадка" },
  { key: "assembly", label: "Збірка" }
];

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
    stages: ["cutting", "edging", "drilling", "assembly"]
  },
  manager: {
    canViewSettings: false,
    canManageUsers: false,
    canManageAccess: false,
    canEditOrders: true,
    canEditPositions: true,
    canUseOperatorPanel: false,
    stages: []
  },
  operator: {
    canViewSettings: false,
    canManageUsers: false,
    canManageAccess: false,
    canEditOrders: false,
    canEditPositions: false,
    canUseOperatorPanel: true,
    stages: []
  }
};
