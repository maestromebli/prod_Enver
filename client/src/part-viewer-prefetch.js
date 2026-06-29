import { apiUrl } from "./api.js";

/** Кеш prefetch GLB/WRL після скану — viewer читає buffer без повторного завантаження. */
const inflight = new Map();

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function prefetchViewerModel(url, token = null) {
  const fullUrl = String(url || "").startsWith("http") ? url : apiUrl(url);
  if (!fullUrl || inflight.has(fullUrl)) return inflight.get(fullUrl);

  const task = fetch(fullUrl, {
    headers: authHeaders(token),
    credentials: "include",
    cache: "force-cache"
  })
    .then(async (res) => {
      if (!res.ok) return null;
      return res.arrayBuffer();
    })
    .catch(() => null);

  inflight.set(fullUrl, task);
  return task;
}

export async function takePrefetchedModelBuffer(url, token = null) {
  const fullUrl = String(url || "").startsWith("http") ? url : apiUrl(url);
  const task = inflight.get(fullUrl);
  if (!task) return null;
  inflight.delete(fullUrl);
  return task;
}

export function warmPartViewerChunk() {
  return import("./part-viewer-lazy.js");
}
