import { api } from "./api.js";
import { canManageProcurement, canViewProcurement } from "./auth.js";
import { PROCUREMENT_TAB } from "./constants.js";
import { renderProcurementPanel } from "./constructive-pipeline-panel.js";
import {
  bindProcurementCalendar,
  loadProcurementCalendar,
  renderProcurementCalendar
} from "./procurement-calendar.js";
import {
  bindProcurementMto,
  bindProcurementWarehouse,
  loadProcurementMto,
  loadWarehousePending,
  renderProcurementMto,
  renderProcurementWarehouse
} from "./procurement-warehouse-view.js";
import {
  bindProcurementReturns,
  loadProcurementReturns,
  renderProcurementReturns
} from "./procurement-returns-view.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { procurementStatusLabel } from "@enver/shared/production/constructive-package.js";

export const PROCUREMENT_MODES = [
  { key: "calendar", label: "Календар" },
  { key: "registry", label: "Реєстр" },
  { key: "mto", label: "Під замовлення" },
  { key: "warehouse", label: "Склад" },
  { key: "returns", label: "Рекламації" }
];

const FILTERS = [
  { key: "active", label: "Активні" },
  { key: "all", label: "Усі" },
  { key: "done", label: "Завершені" }
];

function ensureProcurementState() {
  if (!state.procurement) {
    state.procurement = {
      mode: "calendar",
      items: [],
      loading: false,
      filter: "active",
      selectedId: null,
      detail: null,
      detailLoading: false,
      summariesByPositionId: {},
      mtoFilter: "open",
      returnsFilter: "active"
    };
  }
  return state.procurement;
}

export function invalidateProcurementListCache() {
  if (state.procurement) {
    state.procurement.items = [];
    state.procurement.detail = null;
    state.procurement.selectedId = null;
    state.procurement.summariesByPositionId = {};
  }
}

export async function loadProcurementSummaries() {
  if (!canViewProcurement()) return {};
  const proc = ensureProcurementState();
  try {
    const rows = await api.getProcurementSummaries();
    const map = {};
    for (const row of rows) {
      map[row.positionId] = row;
    }
    proc.summariesByPositionId = map;
    return map;
  } catch {
    return proc.summariesByPositionId || {};
  }
}

function syncProcurementSelection(proc) {
  if (proc.selectedId && !proc.items.some((row) => row.id === proc.selectedId)) {
    proc.selectedId = null;
    proc.detail = null;
  }
}

export function procurementTabBadgeCount() {
  const proc = state.procurement;
  const items = proc?.items || [];
  const mtoOverdue = (proc?.mtoItems || []).filter(
    (i) => i.expectedDeliveryDate && i.expectedDeliveryDate < new Date().toISOString().slice(0, 10)
  ).length;
  const active = items.filter((i) => i.isActive).length;
  const returns = (proc?.returns || []).filter((r) => r.isActive).length;
  return active + mtoOverdue + returns;
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

export async function loadProcurementModeData(mode = state.procurement?.mode) {
  const m = mode || "calendar";
  if (m === "calendar") {
    const anchor = state.procurement?.calendar?.anchor;
    const from = anchor || undefined;
    await loadProcurementCalendar({ from });
  } else if (m === "registry") {
    await loadProcurementList();
  } else if (m === "mto") {
    await loadProcurementMto();
  } else if (m === "warehouse") {
    await loadWarehousePending();
  } else if (m === "returns") {
    await loadProcurementReturns();
  }
  await loadProcurementSummaries();
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
  const mtoBadge =
    row.mtoCount > 0 ? `<span class="proc-mto-badge">MTO ${row.mtoCount}</span>` : "";
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
      <span class="procurement-row-meta enver-meta">${row.itemCount} поз. ${mtoBadge} · ${formatDate(row.createdAt)}</span>
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

function renderRegistry(proc) {
  const counts = filterCounts(proc.items);
  const visibleItems = filteredItems(proc.items, proc.filter);
  const selectedId = proc.selectedId;
  const listRow =
    proc.items.find((row) => row.id === selectedId) ||
    visibleItems.find((row) => row.id === selectedId) ||
    null;

  const filterBtns = FILTERS.map(
    (f) =>
      `<button type="button" class="enver-segmented-btn ${proc.filter === f.key ? "active" : ""}" data-procurement-filter="${f.key}">${escapeHtml(f.label)}${counts[f.key] != null ? ` (${counts[f.key]})` : ""}</button>`
  ).join("");

  const rows = visibleItems.length
    ? visibleItems.map((row) => renderRow(row, selectedId)).join("")
    : `<p class="enver-meta procurement-empty">Заявок ще немає. Створіть їх з пакета конструктива або додайте MTO.</p>`;

  return `
    <div class="procurement-layout">
      <div class="procurement-list card" role="list">${rows}</div>
      ${renderDetail(proc, proc.detail, listRow)}
    </div>
    <div class="enver-segmented procurement-filters" role="tablist">${filterBtns}</div>`;
}

function modeButtons(mode) {
  return PROCUREMENT_MODES.map(
    (m) =>
      `<button type="button" class="enver-segmented-btn ${mode === m.key ? "active" : ""}" data-proc-mode="${m.key}">${escapeHtml(m.label)}</button>`
  ).join("");
}

function renderModeBody(proc) {
  if (proc.mode === "calendar") return renderProcurementCalendar();
  if (proc.mode === "mto") return renderProcurementMto();
  if (proc.mode === "warehouse") return renderProcurementWarehouse();
  if (proc.mode === "returns") return renderProcurementReturns();
  return renderRegistry(proc);
}

function procurementSkeleton() {
  return `
    <div class="procurement-screen" aria-busy="true">
      <div class="enver-skeleton procurement-skeleton-hero"></div>
      <div class="enver-skeleton procurement-skeleton-list"></div>
    </div>`;
}

export function renderProcurementTab() {
  if (!canViewProcurement()) {
    return `<div class="note">Немає доступу до закупівель.</div>`;
  }

  const proc = ensureProcurementState();
  if (proc.loading && proc.mode === "registry" && !proc.items.length) return procurementSkeleton();

  const counts = filterCounts(proc.items);

  return `
    <div class="procurement-screen">
      <section class="procurement-hero card">
        <h2 class="procurement-hero-title">Закупівля</h2>
        <p class="procurement-hero-sub">Календар MTO, реєстр заявок, приймання на склад і рекламації.</p>
        <div class="procurement-stats">
          <div class="procurement-stat procurement-stat--active"><strong>${counts.active}</strong><span>Активні заявки</span></div>
          <div class="procurement-stat"><strong>${(proc.mtoItems || []).length}</strong><span>MTO</span></div>
          <div class="procurement-stat"><strong>${(proc.warehousePending || []).length}</strong><span>Очікується</span></div>
          <div class="procurement-stat procurement-stat--done"><strong>${(proc.returns || []).filter((r) => r.isActive).length}</strong><span>Рекламації</span></div>
        </div>
        <div class="enver-segmented procurement-mode-bar" role="tablist">${modeButtons(proc.mode)}</div>
      </section>
      <div id="procurementModeMount">${renderModeBody(proc)}</div>
    </div>`;
}

export function bindProcurementTab(root, { onRefresh, onOpenPosition } = {}) {
  if (!root || !canViewProcurement()) return;

  root.querySelectorAll("[data-proc-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.procMode;
      if (!mode) return;
      ensureProcurementState().mode = mode;
      try {
        await loadProcurementModeData(mode);
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });

  const proc = ensureProcurementState();

  if (proc.mode === "calendar") {
    bindProcurementCalendar(root, { onRefresh, onOpenPosition });
  } else if (proc.mode === "mto") {
    bindProcurementMto(root, { onRefresh, onOpenPosition });
  } else if (proc.mode === "warehouse") {
    bindProcurementWarehouse(root, { onRefresh });
  } else if (proc.mode === "returns") {
    bindProcurementReturns(root, { onRefresh });
  } else {
    bindProcurementRegistry(root, { onRefresh, onOpenPosition });
  }
}

function bindProcurementRegistry(root, { onRefresh, onOpenPosition } = {}) {
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

export async function openProcurementRequest(requestId) {
  const proc = ensureProcurementState();
  proc.mode = "registry";
  proc.selectedId = requestId || null;
  state.activeTab = PROCUREMENT_TAB;
  await loadProcurementList();
  if (requestId) {
    await loadProcurementDetail(requestId);
  }
}

export function getProcurementSummaryForPosition(positionId) {
  return state.procurement?.summariesByPositionId?.[positionId] || null;
}
