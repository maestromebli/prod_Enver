import { api } from "./api.js";
import { canReceiveWarehouse } from "./auth.js";
import { escapeHtml } from "./utils.js";
import {
  PROCUREMENT_STATUSES,
  nextProcurementStatus,
  procurementAdvanceButtonLabel,
  procurementStatusLabel
} from "@enver/shared/production/constructive-package.js";
import {
  mtoCategoryLabel,
  summarizeProcurementItems
} from "@enver/shared/production/procurement.js";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function renderPipelineSteps(currentStatus) {
  const flow = [
    "draft",
    "waiting_approval",
    "approved",
    "ordered",
    "partially_received",
    "received"
  ];
  const idx = flow.indexOf(currentStatus);
  return `<ol class="proc-pipeline-steps" aria-label="Етапи закупівлі">
    ${flow
      .map((step, i) => {
        const done = idx > i || currentStatus === "received";
        const active = step === currentStatus;
        const cls = done ? "is-done" : active ? "is-active" : "";
        return `<li class="proc-pipeline-step ${cls}"><span>${escapeHtml(procurementStatusLabel(step))}</span></li>`;
      })
      .join("")}
  </ol>`;
}

function renderItemRow(item, { canManage, canReceive }) {
  const typeLabel =
    item.procurementClass === "mto" ? mtoCategoryLabel(item.category) : item.itemType || "—";
  const received = Number(item.qtyReceived) || 0;
  const qty = Number(item.qty) || 0;
  const receiveBtn =
    canReceive && !["received", "cancelled"].includes(item.status)
      ? `<button type="button" class="btn btn-xs btn-primary" data-proc-receive-item="${item.id}" title="Прийняти на склад">Прийняти</button>`
      : "";
  const editBtn = canManage
    ? `<button type="button" class="btn btn-xs" data-proc-edit-item="${item.id}" title="Редагувати">✎</button>`
    : "";

  return `<tr class="proc-item-row procurement-status--${escapeHtml(item.status)}">
    <td>${escapeHtml(typeLabel)}</td>
    <td>${escapeHtml(item.name || "—")}</td>
    <td>${escapeHtml(item.article || "—")}</td>
    <td>${escapeHtml(item.qty || "—")} ${escapeHtml(item.unit || "")}</td>
    <td>${received > 0 ? `${received}/` : ""}${qty || "—"}</td>
    <td>${escapeHtml(item.supplier || "—")}</td>
    <td>${escapeHtml(formatDate(item.expectedDeliveryDate))}</td>
    <td>${escapeHtml(procurementStatusLabel(item.status))}</td>
    <td class="proc-item-actions">${receiveBtn}${editBtn}</td>
  </tr>`;
}

export function renderProcurementWorkspace(procurement = null, options = {}) {
  const canManage = options.canManage === true;
  const showCreateHint = options.showCreateHint !== false;

  if (!procurement) {
    return `<section class="procurement-panel procurement-panel--empty">
      <h3 class="drawer-section-title">Закупівля</h3>
      <p class="enver-meta">Закупівлю ще не створено.</p>
      ${
        showCreateHint
          ? `<p class="enver-meta">Позиції формуються з <strong>Excel-специфікації конструктора</strong> після розбору пакета. Натисніть «В закупівлю» на пакеті конструктива або дочекайтесь автоматичного створення.</p>`
          : ""
      }
    </section>`;
  }

  const summary = procurement.summary || summarizeProcurementItems(procurement.items || []);
  const nextStatus = nextProcurementStatus(procurement.status);
  const advanceLabel = procurementAdvanceButtonLabel(procurement.status);
  const isTerminal = ["received", "rejected", "cancelled"].includes(procurement.status);
  const canReceive = canReceiveWarehouse();

  const items = (procurement.items || [])
    .map((item) => renderItemRow(item, { canManage, canReceive }))
    .join("");

  const advanceBtn =
    canManage && nextStatus
      ? `<button type="button" class="btn btn-sm btn-primary" id="advanceProcurementBtn" data-next-status="${escapeHtml(nextStatus)}">→ ${escapeHtml(advanceLabel)}</button>`
      : "";

  const rejectBtn =
    canManage && !isTerminal
      ? `<button type="button" class="btn btn-sm btn-ghost proc-btn-danger" data-proc-status="rejected">Відхилити</button>`
      : "";

  const cancelBtn =
    canManage && !isTerminal
      ? `<button type="button" class="btn btn-sm btn-ghost" data-proc-status="cancelled">Скасувати</button>`
      : "";

  return `
    <section class="procurement-panel">
      <h3 class="drawer-section-title">Закупівля</h3>
      <p class="cp-status-lg procurement-status--${escapeHtml(procurement.status)}">${escapeHtml(procurementStatusLabel(procurement.status))}</p>
      ${!isTerminal ? renderPipelineSteps(procurement.status) : ""}
      <p class="enver-meta proc-summary-line">${escapeHtml(summary.label || `${summary.receivedCount}/${summary.total} отримано`)} · план ${Number(procurement.totalEstimated || 0).toFixed(2)} UAH</p>
      ${
        summary.blockingCount > 0
          ? `<p class="cp-warning">⚠ ${summary.blockingCount} позицій блокують збірку до отримання на склад</p>`
          : ""
      }
      <div class="proc-actions-row">
        ${advanceBtn}
        ${rejectBtn}
        ${cancelBtn}
      </div>
      ${
        items
          ? `<div class="cp-parts-table-wrap">
              <table class="cp-parts-table procurement-items-table">
                <thead><tr>
                  <th>Тип</th><th>Назва</th><th>Артикул</th><th>Кількість</th><th>Отримано</th>
                  <th>Постачальник</th><th>Поставка</th><th>Статус</th><th></th>
                </tr></thead>
                <tbody>${items}</tbody>
              </table>
            </div>`
          : `<p class="enver-meta">Позицій у заявці немає.</p>`
      }
    </section>`;
}

/** @deprecated Використовуйте renderProcurementWorkspace */
export function renderProcurementPanel(procurement, options) {
  return renderProcurementWorkspace(procurement, options);
}

async function promptEditItem(item) {
  const supplier = window.prompt("Постачальник", item.supplier || "");
  if (supplier === null) return null;
  const expectedDeliveryDate =
    window.prompt("Дата поставки (РРРР-ММ-ДД)", item.expectedDeliveryDate || "") ?? "";
  return {
    supplier: supplier.trim(),
    expectedDeliveryDate: expectedDeliveryDate.trim() || null
  };
}

export function bindProcurementWorkspace(root, ctx = {}) {
  if (!root) return;

  const { positionId, getProcurement, onProcurementUpdated } = ctx;

  const refreshAfter = async (updated) => {
    onProcurementUpdated?.(updated);
    const { invalidateProcurementListCache } = await import("./procurement-view.js");
    invalidateProcurementListCache();
  };

  const updateStatus = async (status) => {
    const procurement = getProcurement?.();
    if (!procurement?.id || !positionId) return;
    const { toastError, toastSuccess } = await import("./toast.js");
    try {
      const updated = await api.updatePositionProcurement(positionId, procurement.id, { status });
      await refreshAfter(updated);
      toastSuccess(`Статус: ${procurementStatusLabel(status)}`);
    } catch (err) {
      toastError(err.message);
    }
  };

  root.querySelector("#advanceProcurementBtn")?.addEventListener("click", async () => {
    const btn = root.querySelector("#advanceProcurementBtn");
    const nextStatus = btn?.dataset?.nextStatus;
    if (!nextStatus) return;
    await updateStatus(nextStatus);
  });

  root.querySelectorAll("[data-proc-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.procStatus;
      if (!status) return;
      const label = procurementStatusLabel(status);
      if (!window.confirm(`Змінити статус заявки на «${label}»?`)) return;
      await updateStatus(status);
    });
  });

  root.querySelectorAll("[data-proc-receive-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.procReceiveItem);
      const location = window.prompt("Комірка складу (необовʼязково)", "") ?? "";
      const { toastError, toastSuccess } = await import("./toast.js");
      try {
        const updated = await api.receiveProcurementItem(itemId, { location });
        const procurement = getProcurement?.();
        if (procurement?.id && updated?.id === procurement.id) {
          await refreshAfter(updated);
        } else if (positionId && procurement?.id) {
          const detail = await api.getPositionProcurement(positionId);
          await refreshAfter(detail);
        }
        toastSuccess("Прийнято на склад");
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  root.querySelectorAll("[data-proc-edit-item]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.procEditItem);
      const procurement = getProcurement?.();
      const item = procurement?.items?.find((i) => i.id === itemId);
      if (!item) return;
      const patch = await promptEditItem(item);
      if (!patch) return;
      const { toastError, toastSuccess } = await import("./toast.js");
      try {
        await api.updateProcurementItem(itemId, patch);
        if (positionId) {
          const detail = await api.getPositionProcurement(positionId);
          await refreshAfter(detail);
        }
        toastSuccess("Збережено");
      } catch (err) {
        toastError(err.message);
      }
    });
  });
}

export { PROCUREMENT_STATUSES };
