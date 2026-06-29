import { api } from "./api.js";
import { state } from "./state.js";
import { escapeHtml, $ } from "./utils.js";
import { buildAssistantContext, collectLocalHints, mergeHints } from "./ai-hints.js";

let panelOpen = false;
let aiAvailable = false;
let hints = [];
let summary = "";
let chatHistory = [];
let loadingHints = false;
let loadingChat = false;
let onNavigate = null;

const QUICK_QUESTIONS = [
  "Що зробити зараз?",
  "Як додати позицію?",
  "Що означає прострочка?",
  "Як передати в цех?"
];

function hasHighPriorityHints() {
  return hints.some((h) => h.priority === "high");
}

function renderHintItem(h) {
  const doBtn = h.godmodeAction
    ? `<button type="button" class="ai-hint-action ai-hint-action--do"
        data-ai-entity-type="${escapeHtml(h.godmodeAction.entityType)}"
        data-ai-entity-id="${h.godmodeAction.entityId}"
        data-ai-action-type="${escapeHtml(h.godmodeAction.actionType || "")}">Зробити зараз →</button>`
    : h.action
      ? `<button type="button" class="ai-hint-action" data-ai-nav="${escapeHtml(h.action)}">${escapeHtml(h.action)} →</button>`
      : "";
  return `
    <li class="ai-hint-item ai-hint-item--${h.priority === "high" ? "high" : "normal"}">
      <span class="ai-hint-text">${escapeHtml(h.text)}</span>
      ${doBtn}
    </li>
  `;
}

function renderMessages() {
  if (!chatHistory.length) {
    return `<p class="ai-assistant-muted">Задайте питання про замовлення, етапи або інтерфейс ENVER.</p>`;
  }
  return chatHistory
    .map((m) => {
      const actions =
        m.actions?.length > 0
          ? `<div class="ai-chat-actions">${m.actions
              .map(
                (a, i) =>
                  `<button type="button" class="btn btn-sm ai-chat-action-btn" data-msg-idx="${chatHistory.indexOf(m)}" data-action-idx="${i}">${escapeHtml(a.label)}</button>`
              )
              .join("")}</div>`
          : "";
      const warnings =
        m.warnings?.length > 0
          ? `<ul class="ai-chat-warnings">${m.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
          : "";
      return `
    <div class="ai-chat-msg ai-chat-msg--${m.role}">
      <div class="ai-chat-bubble">${escapeHtml(m.content)}</div>
      ${warnings}
      ${actions}
    </div>`;
    })
    .join("");
}

async function executeAssistantAction(action) {
  if (!action) return;
  const { type, payload, requiresConfirmation } = action;
  if (requiresConfirmation) {
    const ok = window.confirm(`Підтвердити дію: ${action.label}?`);
    if (!ok) return;
  }

  if (type === "open_tab" && onNavigate) {
    onNavigate(payload.tab);
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_attention" && onNavigate) {
    onNavigate("Потребує уваги");
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_production_floor" && onNavigate) {
    const { PRODUCTION_FLOOR_TAB } = await import("./constants.js");
    onNavigate(PRODUCTION_FLOOR_TAB);
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_install_calendar" && onNavigate) {
    onNavigate("Встановлення");
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_settings_ai") {
    const { openSettings } = await import("./settings.js");
    openSettings?.("ai");
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_order" && payload.orderId) {
    const { state } = await import("./state.js");
    state.selectedOrderId = payload.orderId;
    if (onNavigate) onNavigate("Замовлення");
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "open_position" && payload.positionId) {
    const { openPositionFromContext } = await import("./godmode-navigation.js");
    await openPositionFromContext(payload.positionId);
    panelOpen = false;
    renderPanel();
    return;
  }
  if (type === "run_position_action" && payload.positionId) {
    const { executeGodmodeAction } = await import("./godmode-ui.js");
    await executeGodmodeAction({
      entityType: "position",
      entityId: payload.positionId,
      actionType: payload.actionType
    });
    const { toastSuccess } = await import("./toast.js");
    toastSuccess("Дію виконано");
    return;
  }
  if (type === "run_order_action" && payload.orderId) {
    const { executeGodmodeAction } = await import("./godmode-ui.js");
    await executeGodmodeAction({
      entityType: "order",
      entityId: payload.orderId,
      actionType: payload.actionType
    });
    const { toastSuccess } = await import("./toast.js");
    toastSuccess("Дію виконано");
  }
}

function renderPanel() {
  const root = $("#aiAssistantRoot");
  if (!root) return;

  const localOnly = !aiAvailable;
  const hintList =
    hints.length > 0
      ? `<ul class="ai-hint-list">${hints.map(renderHintItem).join("")}</ul>`
      : `<p class="ai-assistant-muted">Підказок поки немає.</p>`;

  root.innerHTML = `
    <div class="ai-assistant-fab-wrap">
      <button
        type="button"
        class="ai-assistant-fab ${hasHighPriorityHints() ? "ai-assistant-fab--pulse" : ""}"
        id="aiAssistantFab"
        aria-expanded="${panelOpen}"
        aria-controls="aiAssistantPanel"
        title="ШІ-помічник ENVER"
      >
        <span class="ai-assistant-fab-icon" aria-hidden="true">✦</span>
        <span class="ai-assistant-fab-label">ШІ</span>
      </button>
    </div>
    <div
      class="ai-assistant-panel ${panelOpen ? "open" : ""}"
      id="aiAssistantPanel"
      role="dialog"
      aria-label="ШІ-помічник"
      aria-hidden="${panelOpen ? "false" : "true"}"
    >
      <header class="ai-assistant-header">
        <div>
          <h2 class="ai-assistant-title">ШІ-помічник</h2>
          <p class="ai-assistant-sub">${localOnly ? "Локальні підказки · увімкніть ШІ в налаштуваннях" : "Контекстні підказки та відповіді"}</p>
        </div>
        <button type="button" class="ai-assistant-close" id="aiAssistantClose" aria-label="Закрити">×</button>
      </header>

      ${summary ? `<div class="ai-assistant-summary">${escapeHtml(summary)}</div>` : ""}

      <section class="ai-assistant-section">
        <h3 class="ai-assistant-section-title">
          Підказки зараз
          ${loadingHints ? '<span class="ai-assistant-spinner" aria-hidden="true"></span>' : ""}
        </h3>
        ${hintList}
        <button type="button" class="btn btn-sm ai-refresh-hints" id="aiRefreshHints" ${loadingHints ? "disabled" : ""}>
          Оновити підказки
        </button>
      </section>

      <section class="ai-assistant-section ai-assistant-chat">
        <h3 class="ai-assistant-section-title">Запитайте</h3>
        <div class="ai-quick-chips">
          ${QUICK_QUESTIONS.map(
            (q) =>
              `<button type="button" class="ai-quick-chip" data-ai-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`
          ).join("")}
        </div>
        <div class="ai-chat-log" id="aiChatLog">${renderMessages()}</div>
        <form class="ai-chat-form" id="aiChatForm">
          <input
            type="text"
            id="aiChatInput"
            class="ai-chat-input"
            placeholder="${aiAvailable ? "Ваше питання…" : "ШІ вимкнено — увімкніть у налаштуваннях"}"
            autocomplete="off"
            ${!aiAvailable || loadingChat ? "disabled" : ""}
          />
          <button type="submit" class="btn btn-primary btn-sm" ${!aiAvailable || loadingChat ? "disabled" : ""}>
            ${loadingChat ? "…" : "Надіслати"}
          </button>
        </form>
      </section>
    </div>
  `;

  bindPanelEvents();
  scrollChatToEnd();
}

function scrollChatToEnd() {
  const log = $("#aiChatLog");
  if (log) log.scrollTop = log.scrollHeight;
}

function bindPanelEvents() {
  $("#aiAssistantFab")?.addEventListener("click", () => {
    panelOpen = !panelOpen;
    if (panelOpen) void refreshHints({ withAi: true });
    renderPanel();
    if (panelOpen) $("#aiChatInput")?.focus();
  });

  $("#aiAssistantClose")?.addEventListener("click", () => {
    panelOpen = false;
    renderPanel();
  });

  $("#aiRefreshHints")?.addEventListener("click", () => {
    void refreshHints({ withAi: true });
  });

  document.querySelectorAll("[data-ai-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dest = btn.dataset.aiNav;
      if (dest && onNavigate) onNavigate(dest);
    });
  });

  document.querySelectorAll(".ai-hint-action--do").forEach((btn) => {
    btn.addEventListener("click", async () => {
      panelOpen = false;
      renderPanel();
      const { executeGodmodeAction } = await import("./godmode-ui.js");
      await executeGodmodeAction({
        entityType: btn.dataset.aiEntityType,
        entityId: Number(btn.dataset.aiEntityId),
        actionType: btn.dataset.aiActionType || undefined
      }).catch(() => {});
    });
  });

  document.querySelectorAll("[data-ai-question]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.dataset.aiQuestion;
      if (q) void sendChat(q);
    });
  });

  $("#aiChatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#aiChatInput");
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";
    void sendChat(text);
  });

  document.querySelectorAll(".ai-chat-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const msg = chatHistory[Number(btn.dataset.msgIdx)];
      const action = msg?.actions?.[Number(btn.dataset.actionIdx)];
      void executeAssistantAction(action);
    });
  });
}

async function refreshHints({ withAi = false } = {}) {
  const local = collectLocalHints(state);
  hints = local;
  summary = "";

  if (!withAi || !aiAvailable) {
    renderInsightBar();
    if (panelOpen) renderPanel();
    return;
  }

  loadingHints = true;
  if (panelOpen) renderPanel();

  try {
    const ctx = buildAssistantContext(state);
    const remote = await api.aiAssist({ mode: "hints", context: ctx });
    hints = mergeHints(local, remote.hints || []);
    summary = remote.summary || "";
  } catch {
    hints = local;
  } finally {
    loadingHints = false;
    renderInsightBar();
    if (panelOpen) renderPanel();
  }
}

async function sendChat(message) {
  if (!aiAvailable || loadingChat) return;

  chatHistory.push({ role: "user", content: message });
  loadingChat = true;
  renderPanel();

  try {
    const ctx = buildAssistantContext(state);
    const result = await api.aiAssist({
      mode: "chat",
      message,
      context: ctx,
      history: chatHistory.slice(0, -1)
    });
    chatHistory.push({
      role: "assistant",
      content: result.reply || "Не вдалося отримати відповідь.",
      actions: result.actions || [],
      warnings: result.warnings || []
    });
  } catch (err) {
    chatHistory.push({
      role: "assistant",
      content: err.message || "Помилка з’єднання з ШІ."
    });
  } finally {
    loadingChat = false;
    renderPanel();
  }
}

function renderInsightBar() {
  let bar = $("#aiInsightBar");
  const header = document.querySelector(".app-shell-header");
  if (!header) return;

  const topHint = hints.find((h) => h.priority === "high") || hints[0];
  if (!topHint || state.view !== "main") {
    bar?.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement("div");
    bar.id = "aiInsightBar";
    bar.className = "ai-insight-bar";
    bar.setAttribute("role", "status");
    header.appendChild(bar);
  }

  bar.innerHTML = `
    <span class="ai-insight-icon" aria-hidden="true">✦</span>
    <span class="ai-insight-text">${escapeHtml(summary || topHint.text)}</span>
    <button type="button" class="ai-insight-more" id="aiInsightOpen">Детальніше</button>
    <button type="button" class="ai-insight-dismiss" id="aiInsightDismiss" aria-label="Приховати">×</button>
  `;

  $("#aiInsightOpen")?.addEventListener("click", () => {
    panelOpen = true;
    void refreshHints({ withAi: true });
    renderPanel();
  });

  $("#aiInsightDismiss")?.addEventListener("click", () => {
    bar?.remove();
  });
}

async function loadAiStatus() {
  try {
    const status = await api.getAiStatus();
    aiAvailable = Boolean(status.available);
  } catch {
    aiAvailable = false;
  }
}

export function initAiAssistant({ onNavigate: navigate } = {}) {
  onNavigate = navigate;

  if (!$("#aiAssistantRoot")) {
    const root = document.createElement("div");
    root.id = "aiAssistantRoot";
    root.className = "ai-assistant-root";
    document.body.appendChild(root);
  }

  void loadAiStatus().then(() => {
    refreshHints({ withAi: false });
    renderPanel();
  });
}

/** Викликати після зміни вкладки / даних — оновлює підказки та смужку. */
export function notifyAiContextChanged() {
  if (!state.currentUser) return;
  void refreshHints({ withAi: panelOpen && aiAvailable });
  if (!panelOpen) {
    const fab = $("#aiAssistantFab");
    fab?.classList.toggle("ai-assistant-fab--pulse", hasHighPriorityHints());
  }
}

export function hideAiAssistant() {
  panelOpen = false;
  $("#aiAssistantRoot")?.remove();
  $("#aiInsightBar")?.remove();
}
