import { api, getStoredToken, setStoredToken } from "./api.js";
import { state } from "./state.js";

const STORAGE_KEY = "enver_user";

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
  stopMachinePolling();
}

export function isAdmin() {
  return state.currentUser?.role === "admin";
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

export function isOperator() {
  return state.currentUser?.role === "operator";
}

export function operatorStages() {
  const fromUser = state.currentUser?.stages || [];
  const fromPerms = state.currentUser?.permissions?.stages || [];
  return [...new Set([...fromUser, ...fromPerms])];
}

export function hasOperatorAccess() {
  if (!state.currentUser) return false;
  if (isAdmin() && state.currentUser.permissions?.canUseOperatorPanel) return true;
  return isOperator() && operatorStages().length > 0;
}

let pollTimer = null;

export function startMachinePolling(callback, intervalMs = 3000) {
  stopMachinePolling();
  pollTimer = setInterval(callback, intervalMs);
}

export function stopMachinePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
