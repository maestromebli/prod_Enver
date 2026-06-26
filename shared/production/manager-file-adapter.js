/** Мапінг legacy constructor_workspace_files → канонічні manager_* kinds. */

export const WORKSPACE_TO_MANAGER_KIND = {
  tech: "manager_appliance",
  measurements: "manager_measurement",
  manager_image: "manager_photo",
  custom: "manager_other"
};

export function workspaceKindToManagerKind(workspaceKind) {
  return WORKSPACE_TO_MANAGER_KIND[workspaceKind] || "manager_other";
}

export function managerKindToWorkspaceKind(managerKind) {
  for (const [workspaceKind, mapped] of Object.entries(WORKSPACE_TO_MANAGER_KIND)) {
    if (mapped === managerKind) return workspaceKind;
  }
  return null;
}

export function isWorkspaceManagerKind(kind) {
  return Object.hasOwn(WORKSPACE_TO_MANAGER_KIND, kind);
}

export function parseManagerFileId(fileId) {
  const raw = String(fileId ?? "");
  if (raw.startsWith("ws-")) {
    return { source: "workspace", id: Number(raw.slice(3)), raw };
  }
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) {
    return { source: "position_files", id: num, raw };
  }
  return { source: "unknown", id: null, raw };
}

export function formatWorkspaceFileId(workspaceFileId) {
  return `ws-${workspaceFileId}`;
}
