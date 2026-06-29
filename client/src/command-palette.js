import { ATTENTION_TAB, PRODUCTION_FLOOR_TAB } from "./constants.js";
import { escapeHtml, $ } from "./utils.js";

let handlers = {};
let filter = "";
let activeIndex = 0;
let visible = false;

const COMMANDS = [
  { id: "search", label: "Знайти замовлення", hint: "/", run: () => handlers.focusSearch?.() },
  {
    id: "production",
    label: "Відкрити виробництво",
    run: () => handlers.setTab?.(PRODUCTION_FLOOR_TAB)
  },
  {
    id: "attention",
    label: "Показати «Потребує уваги»",
    run: () => handlers.setTab?.(ATTENTION_TAB)
  },
  { id: "install", label: "Відкрити монтажі", run: () => handlers.setTab?.("Встановлення") },
  { id: "operator", label: "Панель цеху", run: () => handlers.openOperatorPanel?.() },
  { id: "settings", label: "Відкрити налаштування", run: () => handlers.openSettings?.() },
  { id: "orders", label: "Замовлення", run: () => handlers.setTab?.("Замовлення") },
  {
    id: "positions",
    label: "Позиції",
    run: () => handlers.setTab?.("Замовлення", { ordersDisplayMode: "positions" })
  },
  {
    id: "upload",
    label: "Завантажити конструктив",
    run: () => handlers.hint?.("Відкрийте позицію → «Стіл конструктора»")
  },
  {
    id: "ai",
    label: "Запустити ШІ-аналіз",
    run: () => handlers.hint?.("У позиції з файлом натисніть «Запустити ШІ-аналіз»")
  }
];

function filteredCommands() {
  const q = filter.trim().toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
}

function renderList() {
  const list = $("#commandPaletteList");
  if (!list) return;
  const items = filteredCommands();
  activeIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
  list.innerHTML = items
    .map(
      (cmd, i) => `
      <button type="button" class="command-palette-item ${i === activeIndex ? "is-active" : ""}" data-cmd="${escapeHtml(cmd.id)}" role="option" aria-selected="${i === activeIndex}">
        <span class="command-palette-label">${escapeHtml(cmd.label)}</span>
        ${cmd.hint ? `<kbd class="command-palette-kbd">${escapeHtml(cmd.hint)}</kbd>` : ""}
      </button>`
    )
    .join("");
}

function openPalette() {
  const el = $("#commandPalette");
  if (!el) return;
  visible = true;
  filter = "";
  activeIndex = 0;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  const input = $("#commandPaletteInput");
  if (input) {
    input.value = "";
    input.focus();
  }
  renderList();
}

function closePalette() {
  const el = $("#commandPalette");
  if (!el) return;
  visible = false;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
}

function runActive() {
  const items = filteredCommands();
  const cmd = items[activeIndex];
  if (!cmd) return;
  closePalette();
  cmd.run?.();
}

export function initCommandPalette(h = {}) {
  handlers = h;
  if ($("#commandPalette")) return;

  const el = document.createElement("div");
  el.id = "commandPalette";
  el.className = "command-palette";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Команди");
  el.innerHTML = `
    <div class="command-palette-panel enver-card-enter">
      <input type="search" id="commandPaletteInput" class="command-palette-input" placeholder="Команда або пошук…" autocomplete="off" aria-label="Пошук команд" />
      <div id="commandPaletteList" class="command-palette-list" role="listbox"></div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target === el) closePalette();
  });

  $("#commandPaletteInput")?.addEventListener("input", (e) => {
    filter = e.target.value;
    activeIndex = 0;
    renderList();
  });

  $("#commandPaletteInput")?.addEventListener("keydown", (e) => {
    const items = filteredCommands();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  });

  $("#commandPaletteList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (!btn) return;
    const id = btn.dataset.cmd;
    const idx = filteredCommands().findIndex((c) => c.id === id);
    if (idx >= 0) activeIndex = idx;
    runActive();
  });
}

export function toggleCommandPalette() {
  if (visible) closePalette();
  else openPalette();
}

export function isCommandPaletteOpen() {
  return visible;
}

export function closeCommandPalette() {
  closePalette();
}
