import { api, getStoredToken, setStoredToken } from "./api.js";
import { state } from "./state.js";
import { DEFAULT_PERMISSIONS } from "@enver/shared/production/permissions.js";

const STORAGE_KEY = "enver_user";

/** Як на сервері: дефолти ролі + збережені права (актуально після оновлень UI). */
export function effectivePermissions(user = state.currentUser) {
  if (!user) return {};
  const defaults = DEFAULT_PERMISSIONS[user.role] || DEFAULT_PERMISSIONS.operator;
  return { ...defaults, ...(user.permissions || {}) };
}

export function loadStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveUser(user, token = null) {
  state.currentUser = user;
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    if (token) setStoredToken(token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
    setStoredToken(null);
  }
}

export async function login(loginName, password) {
  const { user, token } = await api.login({ login: loginName, password });
  saveUser(user, token);
  return user;
}

export async function logout() {
  try {
    if (state.authToken || getStoredToken()) await api.logout();
  } catch {
    /* ignore */
  }
  saveUser(null);
}

export function isAdmin() {
  return state.currentUser?.role === "admin";
}

export function canEditPositionManagerData() {
  return Boolean(
    state.currentUser?.permissions?.canEditPositionManagerData ||
    state.currentUser?.permissions?.canEditOrders
  );
}

export function canViewSettings() {
  return Boolean(state.currentUser?.permissions?.canViewSettings);
}

export function canEditOrders() {
  return Boolean(state.currentUser?.permissions?.canEditOrders);
}

export function canEditPositions() {
  return Boolean(state.currentUser?.permissions?.canEditPositions);
}

export function isProductionHead() {
  return state.currentUser?.role === "production";
}

export function isOperator() {
  return state.currentUser?.role === "operator";
}

export function operatorStages() {
  const fromUser = state.currentUser?.stages || [];
  const fromPerms = state.currentUser?.permissions?.stages || [];
  return [...new Set([...fromUser, ...fromPerms])];
}

export function canViewProductionFloor() {
  return Boolean(state.currentUser?.permissions?.canViewProductionFloor);
}

export function canManageConstructorDesk() {
  return Boolean(isAdmin() || state.currentUser?.permissions?.canManageConstructorDesk);
}

export function canWorkConstructorDesk() {
  return Boolean(
    isAdmin() ||
    state.currentUser?.permissions?.canWorkConstructorDesk ||
    state.currentUser?.permissions?.canManageConstructorDesk
  );
}

export function canViewConstructorDesk() {
  return canWorkConstructorDesk();
}

export function canManageProcurement() {
  return Boolean(effectivePermissions().canManageProcurement);
}

export function canViewProcurement() {
  return canManageProcurement();
}

export function canReviewConstructive() {
  return Boolean(
    state.currentUser?.role === "admin" || state.currentUser?.permissions?.canReviewConstructive
  );
}

export function canApproveConstructive() {
  return Boolean(
    state.currentUser?.role === "admin" || state.currentUser?.permissions?.canApproveConstructive
  );
}

export function isSupervisorOperatorPanel() {
  if (!state.currentUser?.permissions?.canUseOperatorPanel) return false;
  return state.currentUser.role !== "operator";
}

export function hasOperatorAccess() {
  if (!state.currentUser) return false;
  if (state.currentUser.permissions?.canUseOperatorPanel) {
    if (isOperator()) return operatorStages().length > 0;
    return true;
  }
  return false;
}

export function shouldShowProductionFloorByDefault() {
  return isProductionHead() && canViewProductionFloor();
}

export async function refreshCurrentUser() {
  const token = getStoredToken();
  if (!token) return null;
  setStoredToken(token);
  try {
    const { user } = await api.getAuthMe();
    saveUser(user);
    return user;
  } catch {
    logout();
    return null;
  }
}

export function initAuthFromStorage() {
  const token = getStoredToken();
  if (token) setStoredToken(token);
  const stored = loadStoredUser();
  if (stored) state.currentUser = stored;
}
