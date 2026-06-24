import { api } from "./api.js";
import { ATTENTION_TAB } from "./constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { emitRoleNotifications, reminderSnapshot } from "./role-notifications.js";

const POLL_MS = 45_000;
let pollTimer = null;
let panelOpen = false;

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
  }
}

async function fetchGodmodeNotifications() {
  if (!state.currentUser) return;
  try {
    const items = await api.getNotifications();
    const prevCount = godmodeNotificationCount();
    state.godmodeNotifications = {
      items: Array.isArray(items) ? items : [],
      fetchedAt: new Date().toISOString()
    };
    updateGodmodeNotifyBadge();
    const nextCount = godmodeNotificationCount();
    if (nextCount > prevCount) {
      await emitRoleNotifications({
        ...reminderSnapshot(),
        attentionAlerts: Math.max(reminderSnapshot().attentionAlerts, nextCount)
      });
    }
  } catch {
    /* тихо — наступний poll */
  }
}

function bindPanelItems(container) {
  container.querySelectorAll("[data-gn-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entityType = btn.dataset.gnEntityType;
      const entityId = Number(btn.dataset.gnEntityId);
      closeGodmodeNotifyPanel();
      if (entityType === "position" && entityId) {
        window.__enverOpenPosition?.(entityId);
        return;
      }
      state.activeTab = ATTENTION_TAB;
      window.__enverRender?.({ contentOnly: true });
    });
  });
}

export function bindGodmodeNotifyActions(root = document) {
  root.querySelector("#godmodeNotifyBtn")?.addEventListener("click", () => {
    panelOpen = !panelOpen;
    const panel = root.querySelector("#godmodeNotifyPanel");
    if (!panel) return;
    panel.hidden = !panelOpen;
    panel.classList.toggle("gn-panel--open", panelOpen);
    if (panelOpen) {
      void fetchGodmodeNotifications();
      bindPanelItems(panel.querySelector(".gn-panel-body"));
    }
  });

  root.querySelector("#godmodeNotifyClose")?.addEventListener("click", closeGodmodeNotifyPanel);

  root.querySelector("#godmodeNotifyOpenAttention")?.addEventListener("click", () => {
    closeGodmodeNotifyPanel();
    state.activeTab = ATTENTION_TAB;
    window.__enverRender?.({ contentOnly: true });
  });

  document.addEventListener("click", (e) => {
    if (!panelOpen) return;
    if (e.target.closest(".gn-wrap")) return;
    closeGodmodeNotifyPanel();
  });
}

function closeGodmodeNotifyPanel() {
  panelOpen = false;
  const panel = document.querySelector("#godmodeNotifyPanel");
  if (panel) {
    panel.hidden = true;
    panel.classList.remove("gn-panel--open");
  }
}

export function startGodmodeNotificationPolling() {
  stopGodmodeNotificationPolling();
  if (!state.currentUser) return;
  void fetchGodmodeNotifications();
  pollTimer = setInterval(() => void fetchGodmodeNotifications(), POLL_MS);
}

export function stopGodmodeNotificationPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
