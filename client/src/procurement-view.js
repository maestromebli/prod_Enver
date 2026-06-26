import { api } from "./api.js";
import { canManageProcurement } from "./auth.js";
import { PROCUREMENT_TAB } from "./constants.js";
import { renderProcurementPanel } from "./constructive-pipeline-panel.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { procurementStatusLabel } from "@enver/shared/production/constructive-package.js";

const FILTERS = [
  { key: "active", label: "Активні" },
  { key: "all", label: "Усі" },
  { key: "done", label: "Завершені" }
];

function ensureProcurementState() {
  if (!state.procurement) {
    state.procurement = {
      items: [],
      loading: false,
      filter: "active",
      selectedId: null,
      detail: null,
      detailLoading: false
    };
  }
  return state.procurement;
}

export function invalidateProcurementListCache() {
  if (state.procurement) {
    state.procurement.items = [];
    state.procurement.detail = null;
    state.procurement.selectedId = null;
  }
}

function syncProcurementSelection(proc) {
  if (proc.selectedId && !proc.items.some((row) => row.id === proc.selectedId)) {
    proc.selectedId = null;
    proc.detail = null;
  }
}

export function procurementTabBadgeCount() {
  const items = state.procurement?.items || [];
  if (!items.length) return 0;
  return items.filter((item) => item.isActive).length;
}

function filteredItems(items, filter) {
  if (filter === "active") return items.filter((i) => i.isActive);
  if (filter === "done") return items.filter((i) => !i.isActive);
  return items;
}

export async function loadProcurementList({ filter } = {}) {
  const proc = ensureProcurementState();
  if (filter) proc.filter = filter;
  proc.loading = true;
  try {
    proc.items = await api.listProcurementRequests({ status: "all" });
    syncProcurementSelection(proc);
    return proc.items;
  } finally {
    proc.loading = false;
  }
}

async function loadProcurementDetail(requestId) {
  const proc = ensureProcurementState();
  proc.detailLoading = true;
  try {
    proc.detail = await api.getProcurementRequest(requestId);
    return proc.detail;
  } finally {
    proc.detailLoading = false;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function filterCounts(items = []) {
  const active = items.filter((i) => i.isActive).length;
  return { active, all: items.length, done: items.length - active };
}

function renderRow(row, selectedId) {
  const title = [row.orderNumber, row.item].filter(Boolean).join(" · ") || `Заявка #${row.id}`;
  const meta = [row.orderClient, row.object, row.constructor].filter(Boolean).join(" · ");
  return `
    <button
      type="button"
      class="procurement-row ${selectedId === row.id ? "is-selected" : ""}"
      data-procurement-id="${row.id}"
      aria-pressed="${selectedId === row.id}"
    >
      <span class="procurement-row-main">
        <strong>${escapeHtml(title)}</strong>
        <span class="enver-meta">${escapeHtml(meta || "—")}</span>
      </span>
      <span class="procurement-row-status procurement-status--${escapeHtml(row.status)}">${escapeHtml(procurementStatusLabel(row.status))}</span>
      <span class="procurement-row-meta enver-meta">${row.itemCount} поз. · ${formatDate(row.createdAt)}</span>
    </button>`;
}

function renderDetail(proc, detail, listRow) {
  if (proc.detailLoading) {
    return `<div class="procurement-detail procurement-detail--loading enver-meta">Завантаження…</div>`;
  }
  if (!detail || (proc.selectedId != null && !listRow)) {
    return `<div class="procurement-detail procurement-detail--empty enver-meta">Оберіть заявку зі списку</div>`;
  }

  const header = listRow
    ? `<div class="procurement-detail-head">
        <h3 class="procurement-detail-title">${escapeHtml([listRow.orderNumber, listRow.item].filter(Boolean).join(" · "))}</h3>
        <p class="enver-meta">${escapeHtml([listRow.orderClient, listRow.object].filter(Boolean).join(" · ") || "—")}</p>
        <button type="button" class="btn btn-sm" data-procurement-open-position="${listRow.positionId}">Відкрити позицію</button>
      </div>`
    : "";

  return `
    <div class="procurement-detail">
      ${header}
      <div id="procurementDetailPanelMount">${renderProcurementPanel(detail, { canManage: canManageProcurement() })}</div>
    </div>`;
}

function procurementSkeleton() {
  return `
    <div class="procurement-screen" aria-busy="true">
      <div class="enver-skeleton procurement-skeleton-hero"></div>
      <div class="procurement-layout">
        <div class="enver-skeleton procurement-skeleton-list"></div>
        <div class="enver-skeleton procurement-skeleton-detail"></div>
      </div>
    </div>`;
}

export function renderProcurementTab() {
  if (!canManageProcurement()) {
    return `<div class="note">Немає доступу до реєстру закупівель.</div>`;
  }

  const proc = ensureProcurementState();
  if (proc.loading && !proc.items.length) return procurementSkeleton();

  const counts = filterCounts(proc.items);
  const visibleItems = filteredItems(proc.items, proc.filter);
  const selectedId = proc.selectedId;
  const listRow =
    proc.items.find((row) => row.id === selectedId) ||
    visibleItems.find((row) => row.id === selectedId) ||
    null;

  const filterBtns = FILTERS.map(
    (f) => `
      <button
        type="button"
        class="enver-segmented-btn ${proc.filter === f.key ? "active" : ""}"
        data-procurement-filter="${f.key}"
      >${escapeHtml(f.label)}${counts[f.key] != null ? ` (${counts[f.key]})` : ""}</button>`
  ).join("");

  const rows = visibleItems.length
    ? visibleItems.map((row) => renderRow(row, selectedId)).join("")
    : `<p class="enver-meta procurement-empty">Заявок ще немає. Створіть їх кнопкою «В закупівлю» у пакеті конструктива після розбору Excel.</p>`;

  return `
    <div class="procurement-screen">
      <section class="procurement-hero card">
        <h2 class="procurement-hero-title">Заявки на закупівлю</h2>
        <p class="procurement-hero-sub">Список формується з Excel-специфікації конструктора після натискання «В закупівлю» у пакеті конструктива.</p>
        <div class="procurement-stats">
          <div class="procurement-stat procurement-stat--active"><strong>${counts.active}</strong><span>Активні</span></div>
          <div class="procurement-stat"><strong>${counts.all}</strong><span>Усього</span></div>
          <div class="procurement-stat procurement-stat--done"><strong>${counts.done}</strong><span>Завершені</span></div>
        </div>
        <div class="enver-segmented procurement-filters" role="tablist">${filterBtns}</div>
      </section>
      <div class="procurement-layout">
        <div class="procurement-list card" role="list">${rows}</div>
        ${renderDetail(proc, proc.detail, listRow)}
      </div>
    </div>`;
}

export function bindProcurementTab(root, { onRefresh, onOpenPosition } = {}) {
  if (!root || !canManageProcurement()) return;

  root.querySelectorAll("[data-procurement-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const filter = btn.dataset.procurementFilter;
      if (!filter) return;
      ensureProcurementState().filter = filter;
      try {
        await loadProcurementList({ filter });
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });

  root.querySelectorAll("[data-procurement-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.procurementId);
      if (!id) return;
      const proc = ensureProcurementState();
      proc.selectedId = id;
      try {
        await loadProcurementDetail(id);
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });

  root.querySelector("[data-procurement-open-position]")?.addEventListener("click", () => {
    const positionId = Number(
      root.querySelector("[data-procurement-open-position]")?.dataset.procurementOpenPosition
    );
    if (positionId) onOpenPosition?.(positionId);
  });

  root.querySelector("#advanceProcurementBtn")?.addEventListener("click", async () => {
    const proc = ensureProcurementState();
    const btn = root.querySelector("#advanceProcurementBtn");
    const nextStatus = btn?.dataset?.nextStatus;
    const detail = proc.detail;
    const listRow = proc.items.find((row) => row.id === proc.selectedId);
    if (!nextStatus || !detail?.id || !listRow?.positionId) return;
    try {
      const updated = await api.updatePositionProcurement(listRow.positionId, detail.id, {
        status: nextStatus
      });
      proc.detail = updated;
      const idx = proc.items.findIndex((row) => row.id === detail.id);
      if (idx >= 0) {
        proc.items[idx] = {
          ...proc.items[idx],
          status: updated.status,
          isActive: !["received", "rejected", "cancelled"].includes(updated.status)
        };
      }
      onRefresh?.();
    } catch (err) {
      const { toastError } = await import("./toast.js");
      toastError(err.message);
    }
  });
}

/** Перехід на вкладку закупівлі з фокусом на заявку (після створення з конструктива). */
export async function openProcurementRequest(requestId) {
  ensureProcurementState().selectedId = requestId || null;
  state.activeTab = PROCUREMENT_TAB;
  await loadProcurementList();
  if (requestId) {
    await loadProcurementDetail(requestId);
  }
}
