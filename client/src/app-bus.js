/**
 * Легкий event bus замість прямих викликів window.__enverRender.
 */

const renderListeners = new Set();

export function onAppRender(listener) {
  if (typeof listener !== "function") return () => {};
  renderListeners.add(listener);
  return () => renderListeners.delete(listener);
}

export function requestAppRender(options = {}) {
  for (const listener of renderListeners) {
    try {
      listener(options);
    } catch (err) {
      console.error("[app-bus] render listener failed", err);
    }
  }
}

export function wireAppRenderBus(renderFn) {
  onAppRender(renderFn);
  if (typeof window !== "undefined") {
    window.__enverRender = requestAppRender;
    window.__enverRequestRender = requestAppRender;
  }
}
