import { state } from "./state.js";

const API_BASE =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "";

const TOKEN_KEY = "enver_token";

function apiUrl(path) {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

function networkErrorHelp() {
  const port = typeof window !== "undefined" ? window.location.port : "3001";
  if (port === "5173") {
    return "Сервер не відповідає. Запустіть npm run dev у корені проєкту (http://localhost:3001).";
  }
  return `Сервер недоступний. У корені проєкту: npm run dev, потім http://localhost:3001.`;
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  state.authToken = token || null;
}

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = state.authToken || getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(apiUrl(path), { headers, ...options });
  } catch (err) {
    const msg = err?.message === "Failed to fetch" ? networkErrorHelp() : err?.message;
    throw new Error(msg || networkErrorHelp());
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    setStoredToken(null);
    throw new Error(data.error || "Сесія закінчилась — увійдіть знову");
  }
  if (!response.ok) {
    throw new Error(data.error || `Помилка ${response.status}`);
  }

  return data;
}

export const api = {
  getOrders: () => request("/api/orders"),
  getOrder: (id) => request(`/api/orders/${id}`),
  createOrder: (body) => request("/api/orders", { method: "POST", body: JSON.stringify(body) }),
  updateOrder: (id, body) => request(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteOrder: (id) => request(`/api/orders/${id}`, { method: "DELETE" }),

  getPositions: () => request("/api/positions"),
  getPosition: (id) => request(`/api/positions/${id}`),
  createPosition: (body) => request("/api/positions", { method: "POST", body: JSON.stringify(body) }),
  updatePosition: (id, body) => request(`/api/positions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  patchPositionStage: (id, stageKey, body) =>
    request(`/api/positions/${id}/stage/${stageKey}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  patchPositionInstall: (id, body) =>
    request(`/api/positions/${id}/install`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deletePosition: (id) => request(`/api/positions/${id}`, { method: "DELETE" }),

  getKpis: () => request("/api/kpis"),
  getKpiTrends: (days = 14) => request(`/api/kpis/trends?days=${days}`),
  getDirectories: () => request("/api/directories"),
  updateDirectories: (body) =>
    request("/api/directories", { method: "PUT", body: JSON.stringify(body) }),

  login: (body) => request("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  getAuthMe: () => request("/api/auth/me"),

  getUsers: () => request("/api/users"),
  createUser: (body) => request("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: "DELETE" }),

  getPermissions: () => request("/api/users/permissions"),
  updatePermissions: (body) =>
    request("/api/users/permissions", { method: "PUT", body: JSON.stringify(body) }),

  getMachineConfig: () => request("/api/users/machine-config"),
  updateMachineConfig: (stageKey, body) =>
    request(`/api/users/machine-config/${stageKey}`, { method: "PUT", body: JSON.stringify(body) }),

  getMachineProgress: (stageKey) => request(`/api/machine/progress/${stageKey}`),

  getMachineLogEvents: (stageKey, limit = 20) =>
    request(`/api/machine/logs/events/${stageKey}?limit=${limit}`),
  ingestMachineLog: (stageKey, body = {}) =>
    request(`/api/machine/logs/ingest/${stageKey}`, { method: "POST", body: JSON.stringify(body) }),
  uploadMachineLog: (stageKey, text) =>
    request(`/api/machine/logs/upload/${stageKey}`, {
      method: "POST",
      body: JSON.stringify({ text })
    }),
  confirmMachineMatch: (matchId) =>
    request(`/api/machine/logs/match/${matchId}/confirm`, { method: "PUT" }),

  getClientsInfo: () => request("/api/clients/info"),

  getAiSettings: () => request("/api/settings/ai"),
  updateAiSettings: (body) =>
    request("/api/settings/ai", { method: "PUT", body: JSON.stringify(body) }),
  testAiSettings: () => request("/api/settings/ai/test", { method: "POST" }),

  getProductionFloor: () => request("/api/production/floor"),

  getOperatorQueue: (stageKey) => request(`/api/operator/queue/${stageKey}`),
  operatorStart: (body) => request("/api/operator/start", { method: "POST", body: JSON.stringify(body) }),
  operatorPause: (body) => request("/api/operator/pause", { method: "POST", body: JSON.stringify(body) }),
  operatorResume: (body) => request("/api/operator/resume", { method: "POST", body: JSON.stringify(body) }),
  operatorFinish: (body) => request("/api/operator/finish", { method: "POST", body: JSON.stringify(body) }),

  getHistory: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        q.set(key, String(value));
      }
    });
    const qs = q.toString();
    return request(`/api/history${qs ? `?${qs}` : ""}`);
  }
};
