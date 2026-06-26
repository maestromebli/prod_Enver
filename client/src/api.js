import { state } from "./state.js";

const API_BASE =
  typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";

const TOKEN_KEY = "enver_token";

export function apiUrl(path) {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}

function networkErrorHelp() {
  const port = typeof window !== "undefined" ? window.location.port : "3000";
  if (port === "5173") {
    return "Сервер не відповідає. Запустіть npm run dev у корені проєкту (http://localhost:3000).";
  }
  return `Сервер недоступний. У корені проєкту: npm run dev, потім http://localhost:3000.`;
}

/** Розпаковує v2 { ok, data } або legacy-відповідь. */
export function unwrapApiPayload(data) {
  if (data && typeof data.ok === "boolean") {
    if (!data.ok) {
      const msg = data.error?.message || data.error || "Помилка запиту";
      const err = new Error(msg);
      err.code = data.error?.code;
      throw err;
    }
    return data.data !== undefined ? data.data : null;
  }
  if (data?.error && typeof data.error === "string") {
    const err = new Error(data.error);
    throw err;
  }
  return data;
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

  const raw = await response.json().catch(() => ({}));

  if (response.status === 401) {
    setStoredToken(null);
    const msg =
      raw?.error?.message ||
      (typeof raw?.error === "string" ? raw.error : null) ||
      "Сесія закінчилась — увійдіть знову";
    throw new Error(msg);
  }

  if (!response.ok) {
    const msg =
      raw?.error?.message ||
      (typeof raw?.error === "string" ? raw.error : null) ||
      `Помилка ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.code = raw?.code || raw?.error?.code;
    throw err;
  }

  return unwrapApiPayload(raw);
}

export const api = {
  getOrders: () => request("/api/orders"),
  getOrder: (id) => request(`/api/orders/${id}`),
  createOrder: (body) => request("/api/orders", { method: "POST", body: JSON.stringify(body) }),
  updateOrder: (id, body) =>
    request(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteOrder: (id) => request(`/api/orders/${id}`, { method: "DELETE" }),

  getPositions: () => request("/api/positions"),
  getPosition: (id) => request(`/api/positions/${id}`),
  getPositionManagerData: (id) => request(`/api/positions/${id}/manager-data`),
  savePositionManagerData: (id, body) =>
    request(`/api/positions/${id}/manager-data`, { method: "PUT", body: JSON.stringify(body) }),
  uploadPositionManagerFile: (id, body) =>
    request(`/api/positions/${id}/files`, { method: "POST", body: JSON.stringify(body) }),
  deletePositionManagerFile: (id, fileId) =>
    request(`/api/positions/${id}/files/${fileId}`, { method: "DELETE" }),
  createPosition: (body) =>
    request("/api/positions", { method: "POST", body: JSON.stringify(body) }),
  updatePosition: (id, body) =>
    request(`/api/positions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  patchPositionStage: (id, stageKey, body) =>
    request(`/api/positions/${id}/stage/${stageKey}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  uploadConstructiveFile: (id, body) =>
    request(`/api/positions/${id}/constructive-file`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getConstructiveFiles: (id) => request(`/api/positions/${id}/constructive-files`),
  createProductionTasks: (id, stages) =>
    request(`/api/positions/${id}/create-tasks`, {
      method: "POST",
      body: JSON.stringify({ stages })
    }),
  patchPositionInstall: (id, body) =>
    request(`/api/positions/${id}/install`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deletePosition: (id) => request(`/api/positions/${id}`, { method: "DELETE" }),

  getKpis: () => request("/api/kpis"),
  getDirectories: () => request("/api/directories"),
  updateDirectories: (body) =>
    request("/api/directories", { method: "PUT", body: JSON.stringify(body) }),

  login: async (body) => {
    const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
    return data;
  },
  logout: () => request("/api/auth/logout", { method: "POST" }),
  getAuthMe: () => request("/api/auth/me"),

  getUsers: () => request("/api/users"),
  createUser: (body) => request("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id, body) =>
    request(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: "DELETE" }),

  getPermissions: () => request("/api/users/permissions"),
  updatePermissions: (body) =>
    request("/api/users/permissions", { method: "PUT", body: JSON.stringify(body) }),

  getClientsInfo: () => request("/api/clients/info"),

  getAiSettings: () => request("/api/settings/ai"),
  updateAiSettings: (body) =>
    request("/api/settings/ai", { method: "PUT", body: JSON.stringify(body) }),
  testAiSettings: () => request("/api/settings/ai/test", { method: "POST" }),

  analyzeConstructive: (positionId) =>
    request(`/api/ai/analyze-constructive/${positionId}`, { method: "POST" }),
  getConstructiveAnalyses: (positionId) => request(`/api/ai/analyses/${positionId}`),
  getRecentAiAnalyses: () => request("/api/ai/recent"),
  submitAiFeedback: (body) =>
    request("/api/ai/feedback", { method: "POST", body: JSON.stringify(body) }),

  getAiStatus: () => request("/api/ai/status"),
  aiAssist: (body) => request("/api/ai/assist", { method: "POST", body: JSON.stringify(body) }),

  getAiLearningSummary: () => request("/api/ai/learning/summary"),
  getAiRules: () => request("/api/ai/rules"),
  createAiRule: (body) => request("/api/ai/rules", { method: "POST", body: JSON.stringify(body) }),
  updateAiRule: (id, body) =>
    request(`/api/ai/rules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAiRule: (id) => request(`/api/ai/rules/${id}`, { method: "DELETE" }),

  getProductionFloor: () => request("/api/production/floor"),

  getConstructorDeskOrders: (params = {}) => {
    const q = params.mine ? "?mine=1" : "";
    return request(`/api/constructor-desk/orders${q}`);
  },
  getConstructorDeskPositions: (params = {}) => {
    const q = params.mine ? "?mine=1" : "";
    return request(`/api/constructor-desk/positions${q}`);
  },
  getConstructorDeskConstructors: () => request("/api/constructor-desk/constructors"),
  getConstructorDeskPosition: (id) => request(`/api/constructor-desk/positions/${id}`),
  assignConstructorDesk: (id, body) =>
    request(`/api/constructor-desk/positions/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  saveConstructorDeskWorkspace: (id, body) =>
    request(`/api/constructor-desk/positions/${id}/workspace`, {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  addConstructorDeskComment: (id, body) =>
    request(`/api/constructor-desk/positions/${id}/comments`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  uploadConstructorDeskFile: (id, body) =>
    request(`/api/constructor-desk/positions/${id}/files`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  suggestConstructorTiming: (id) =>
    request(`/api/constructor-desk/positions/${id}/suggest-timing`, { method: "POST" }),

  getNotifications: () => request("/api/notifications"),
  runPositionNextAction: (id, actionType) =>
    request(`/api/positions/${id}/run-next-action`, {
      method: "POST",
      body: JSON.stringify({ actionType })
    }),
  runOrderNextAction: (id, actionType) =>
    request(`/api/orders/${id}/run-next-action`, {
      method: "POST",
      body: JSON.stringify({ actionType })
    }),

  getOperatorQueue: (stageKey) => request(`/api/operator/queue/${stageKey}`),
  operatorStart: (body) =>
    request("/api/operator/start", { method: "POST", body: JSON.stringify(body) }),
  operatorPause: (body) =>
    request("/api/operator/pause", { method: "POST", body: JSON.stringify(body) }),
  operatorResume: (body) =>
    request("/api/operator/resume", { method: "POST", body: JSON.stringify(body) }),
  operatorFinish: (body) =>
    request("/api/operator/finish", { method: "POST", body: JSON.stringify(body) }),
  operatorReportProblem: (body) =>
    request("/api/operator/report-problem", { method: "POST", body: JSON.stringify(body) }),
  getOperatorJob: (positionId) => request(`/api/operator/job/${positionId}`),

  getHistory: (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        q.set(key, String(value));
      }
    });
    const qs = q.toString();
    return request(`/api/history${qs ? `?${qs}` : ""}`);
  },

  getHealth: () => request("/api/health"),

  scanPart: (barcode, station = "") => {
    const q = station ? `?station=${encodeURIComponent(station)}` : "";
    return request(`/api/parts/scan/${encodeURIComponent(barcode)}${q}`);
  },
  partCncStart: (partId, body) =>
    request(`/api/parts/${partId}/cnc/start`, { method: "POST", body: JSON.stringify(body) }),
  partCncFinish: (partId, body) =>
    request(`/api/parts/${partId}/cnc/finish`, { method: "POST", body: JSON.stringify(body) }),
  partCncProblem: (partId, body) =>
    request(`/api/parts/${partId}/cnc/problem`, { method: "POST", body: JSON.stringify(body) }),

  getConstructivePackages: (positionId) =>
    request(`/api/positions/${positionId}/constructive-packages`),
  getConstructivePackageLatest: (positionId) =>
    request(`/api/positions/${positionId}/constructive-packages/latest`),
  uploadConstructivePackage: (positionId, files) =>
    request(`/api/positions/${positionId}/constructive-packages`, {
      method: "POST",
      body: JSON.stringify({ files })
    }),
  parseConstructivePackage: (positionId, packageId) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/parse`, {
      method: "POST"
    }),
  approveConstructivePackage: (positionId, packageId) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/approve`, {
      method: "POST"
    }),
  rejectConstructivePackage: (positionId, packageId, reason) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  createProcurementFromPackage: (positionId, packageId) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/procurement`, {
      method: "POST"
    }),
  releaseConstructivePackageToCnc: (positionId, packageId) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/release-cnc`, {
      method: "POST"
    }),
  getPositionProcurement: (positionId) => request(`/api/positions/${positionId}/procurement`),
  updatePositionProcurement: (positionId, requestId, body) =>
    request(`/api/positions/${positionId}/procurement/${requestId}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  analyzeConstructivePackageAi: (positionId, packageId) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/analyze-ai`, {
      method: "POST"
    }),
  saveModelMapping: (positionId, packageId, body) =>
    request(`/api/positions/${positionId}/constructive-packages/${packageId}/model-mapping`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getPositionCncJobs: (positionId) => request(`/api/positions/${positionId}/cnc-jobs`)
};

export function getPartLabelsUrl(positionId) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return apiUrl(`/api/positions/${positionId}/part-labels${q}`);
}

export function constructiveFileDownloadUrl(positionId, fileId = null) {
  const token = getStoredToken();
  const path = fileId
    ? `/api/positions/${positionId}/constructive-file/${fileId}`
    : `/api/positions/${positionId}/constructive-file`;
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return apiUrl(`${path}${q}`);
}

export function constructivePackageFileUrl(positionId, packageId, fileId) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return apiUrl(
    `/api/positions/${positionId}/constructive-packages/${packageId}/files/${fileId}${q}`
  );
}
