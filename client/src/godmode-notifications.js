import { api, getStoredToken } from "./api.js";
import { ATTENTION_TAB } from "./constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { emitRoleNotifications, reminderSnapshot } from "./role-notifications.js";

const POLL_MS = 45_000;
const PANEL_GAP = 8;
const PANEL_MAX_W = 360;
let pollTimer = null;
let eventSource = null;
let panelOpen = false;
let panelRepositionBound = false;

function levelClass(level) {
  if (level === "blocker") return "gn-item--blocker";
  if (level === "warning") return "gn-item--warning";
  return "gn-item--info";
}

export function godmodeNotificationCount() {
  const items = state.godmodeNotifications?.items || [];
  return items.filter((n) => n.level === "blocker" || n.level === "warning").length;
}

function renderPanelItems(items) {
  if (!items.length) {
    return '<p class="gn-empty">Нових сповіщень немає — все під контролем.</p>';
  }
  return items
    .slice(0, 25)
    .map(
      (
        n
      ) => `<button type="button" class="gn-item ${levelClass(n.level)}" data-gn-item="${escapeHtml(n.id)}"
        data-gn-entity-type="${escapeHtml(n.entityType || "")}"
        data-gn-entity-id="${n.entityId ?? ""}"
        data-gn-action="${escapeHtml(n.actionType || "")}">
        <strong>${escapeHtml(n.title)}</strong>
        <span>${escapeHtml(n.message)}</span>
      </button>`
    )
    .join("");
}

export function renderGodmodeNotifyButton() {
  const count = godmodeNotificationCount();
  const badge = count > 0 ? `<span class="gn-badge">${count > 99 ? "99+" : count}</span>` : "";
  return `<button type="button" class="btn-icon gn-bell" id="godmodeNotifyBtn"
    title="Сповіщення системи" aria-label="Сповіщення системи">${badge}🔔</button>`;
}

export function renderGodmodeNotifyPanel() {
  const items = state.godmodeNotifications?.items || [];
  const openClass = panelOpen ? " gn-panel--open" : "";
  return `<div class="gn-panel${openClass}" id="godmodeNotifyPanel" hidden>
    <header class="gn-panel-head">
      <strong>Сповіщення</strong>
      <button type="button" class="btn btn-sm btn-ghost" id="godmodeNotifyClose">Закрити</button>
    </header>
    <div class="gn-panel-body">${renderPanelItems(items)}</div>
    <footer class="gn-panel-foot">
      <button type="button" class="btn btn-sm btn-ghost" id="godmodeNotifyOpenAttention">Потребує уваги</button>
    </footer>
  </div>`;
}

export function mountGodmodeNotifyChrome(root = document) {
  const actions = root.querySelector("#headerActions");
  if (!actions || root.querySelector("#godmodeNotifyBtn")) return;

  const wrap = document.createElement("div");
  wrap.className = "gn-wrap";
  wrap.innerHTML = `${renderGodmodeNotifyButton()}${renderGodmodeNotifyPanel()}`;

  const settingsBtn = root.querySelector("#notifySettingsBtn");
  if (settingsBtn) settingsBtn.before(wrap);
  else actions.prepend(wrap);

  updateGodmodeNotifyBadge();
}

function clearPanelPositionStyles(panel) {
  panel.style.position = "";
  panel.style.top = "";
  panel.style.left = "";
  panel.style.right = "";
  panel.style.width = "";
  panel.style.zIndex = "";
}

function positionGodmodeNotifyPanel() {
  const panel = document.querySelector("#godmodeNotifyPanel");
  const btn = document.querySelector("#godmodeNotifyBtn");
  if (!panel || !btn || panel.hidden) return;

  const rect = btn.getBoundingClientRect();
  const panelWidth = Math.min(PANEL_MAX_W, window.innerWidth * 0.92);
  const pad = 8;
  let left = rect.right - panelWidth;
  if (left < pad) left = pad;
  if (left + panelWidth > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - pad - panelWidth);
  }

  const top = Math.min(rect.bottom + PANEL_GAP, window.innerHeight - pad);
  panel.style.position = "fixed";
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.style.right = "auto";
  panel.style.width = `${panelWidth}px`;
  panel.style.zIndex = "1200";
}

function attachPanelRepositionListeners() {
  if (panelRepositionBound) return;
  panelRepositionBound = true;
  window.addEventListener("resize", positionGodmodeNotifyPanel);
  window.addEventListener("scroll", positionGodmodeNotifyPanel, true);
}

function detachPanelRepositionListeners() {
  if (!panelRepositionBound) return;
  panelRepositionBound = false;
  window.removeEventListener("resize", positionGodmodeNotifyPanel);
  window.removeEventListener("scroll", positionGodmodeNotifyPanel, true);
}

function dockGodmodeNotifyPanel() {
  const panel = document.querySelector("#godmodeNotifyPanel");
  const wrap = document.querySelector(".gn-wrap");
  if (!panel || !wrap || panel.parentElement === wrap) return;
  wrap.appendChild(panel);
  clearPanelPositionStyles(panel);
}

function openGodmodeNotifyPanel(root = document) {
  if (state.view !== "main") return;
  const panel = root.querySelector("#godmodeNotifyPanel");
  if (!panel) return;

  panelOpen = true;
  panel.hidden = false;
  panel.classList.add("gn-panel--open");
  document.body.appendChild(panel);
  positionGodmodeNotifyPanel();
  attachPanelRepositionListeners();
  void fetchGodmodeNotifications();
  bindPanelItems(panel.querySelector(".gn-panel-body"));
}

export function updateGodmodeNotifyBadge() {
  const btn = document.querySelector("#godmodeNotifyBtn");
  if (!btn) return;
  const count = godmodeNotificationCount();
  let badge = btn.querySelector(".gn-badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "gn-badge";
      btn.prepend(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
  } else if (badge) {
    badge.remove();
  }

  const body = document.querySelector("#godmodeNotifyPanel .gn-panel-body");
  if (body && panelOpen) {
    body.innerHTML = renderPanelItems(state.godmodeNotifications?.items || []);
    bindPanelItems(body);
    positionGodmodeNotifyPanel();
  }
}

async function fetchGodmodeNotifications() {
  if (!state.currentUser) return;
  try {
    const items = await api.getNotifications();
    applyNotificationItems(items);
  } catch {
    /* тихо — наступний poll */
  }
}

function applyNotificationItems(items) {
  if (!Array.isArray(items)) return;
  const prevCount = godmodeNotificationCount();
  state.godmodeNotifications = {
    items,
    fetchedAt: new Date().toISOString()
  };
  updateGodmodeNotifyBadge();
  const nextCount = godmodeNotificationCount();
  if (nextCount > prevCount) {
    void emitRoleNotifications({
      ...reminderSnapshot(),
      attentionAlerts: Math.max(reminderSnapshot().attentionAlerts, nextCount)
    });
  }
}

function notificationStreamUrl() {
  const token = getStoredToken();
  if (!token) return null;
  return `/api/notifications/stream?access_token=${encodeURIComponent(token)}`;
}

function startGodmodeNotificationStream() {
  const url = notificationStreamUrl();
  if (!url || typeof EventSource === "undefined") return false;

  eventSource = new EventSource(url);
  eventSource.addEventListener("notifications", (e) => {
    try {
      const payload = JSON.parse(e.data);
      applyNotificationItems(payload.items);
    } catch {
      /* ignore malformed */
    }
  });
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (!pollTimer) {
      pollTimer = setInterval(() => void fetchGodmodeNotifications(), POLL_MS);
    }
  };
  return true;
}

function bindPanelItems(container) {
  container.querySelectorAll("[data-gn-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entityType = btn.dataset.gnEntityType;
      const entityId = Number(btn.dataset.gnEntityId);
      const actionType = btn.dataset.gnAction || undefined;
      closeGodmodeNotifyPanel();
      const { executeGodmodeAction } = await import("./godmode-ui.js");
      await executeGodmodeAction({ entityType, entityId, actionType }).catch(() => {});
    });
  });
}

export function bindGodmodeNotifyActions(root = document) {
  root.querySelector("#godmodeNotifyBtn")?.addEventListener("click", () => {
    if (panelOpen) closeGodmodeNotifyPanel();
    else openGodmodeNotifyPanel(root);
  });

  root.querySelector("#godmodeNotifyClose")?.addEventListener("click", closeGodmodeNotifyPanel);

  root.querySelector("#godmodeNotifyOpenAttention")?.addEventListener("click", () => {
    closeGodmodeNotifyPanel();
    state.activeTab = ATTENTION_TAB;
    window.__enverRender?.({ contentOnly: true });
  });

  document.addEventListener("click", (e) => {
    if (!panelOpen) return;
    if (e.target.closest("#godmodeNotifyBtn")) return;
    if (e.target.closest("#godmodeNotifyPanel")) return;
    closeGodmodeNotifyPanel();
  });
}

export function closeGodmodeNotifyPanel() {
  panelOpen = false;
  detachPanelRepositionListeners();
  const panel = document.querySelector("#godmodeNotifyPanel");
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("gn-panel--open");
    dockGodmodeNotifyPanel();
  }
}

/** Закриває панель і ховає дзвіночок поза головним екраном. */
export function syncGodmodeNotifyForView(view = state.view) {
  if (view !== "main") closeGodmodeNotifyPanel();
  const gnWrap = document.querySelector(".gn-wrap");
  if (gnWrap) gnWrap.hidden = view !== "main";
}

export function startGodmodeNotificationPolling() {
  stopGodmodeNotificationPolling();
  if (!state.currentUser) return;
  void fetchGodmodeNotifications();
  if (!startGodmodeNotificationStream()) {
    pollTimer = setInterval(() => void fetchGodmodeNotifications(), POLL_MS);
  }
}

export function stopGodmodeNotificationPolling() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
