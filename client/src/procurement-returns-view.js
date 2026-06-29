import { api } from "./api.js";
import { canManageProcurement } from "./auth.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import {
  returnReasonLabel,
  returnStatusLabel,
  nextReturnStatus
} from "@enver/shared/production/procurement.js";

export async function loadProcurementReturns({ status } = {}) {
  const proc = state.procurement;
  if (status) proc.returnsFilter = status;
  proc.returnsLoading = true;
  try {
    proc.returns = await api.listProcurementReturns({
      status: proc.returnsFilter || "active"
    });
    return proc.returns;
  } finally {
    proc.returnsLoading = false;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA");
}

export function renderProcurementReturns() {
  const proc = state.procurement || {};
  const items = proc.returns || [];

  if (proc.returnsLoading && !items.length) {
    return `<div class="enver-meta">Завантаження рекламацій…</div>`;
  }

  const rows = items.length
    ? items
        .map((row) => {
          const next = nextReturnStatus(row.status);
          const advanceBtn =
            canManageProcurement() && next
              ? `<button type="button" class="btn btn-sm" data-ret-advance="${row.id}" data-ret-next="${next}">→ ${escapeHtml(returnStatusLabel(next))}</button>`
              : "";
          const replaceBtn =
            canManageProcurement() && row.status === "accepted"
              ? `<button type="button" class="btn btn-sm" data-ret-replace="${row.id}">Замовити заміну</button>`
              : "";
          return `<tr>
            <td>${escapeHtml([row.orderNumber, row.positionItem].filter(Boolean).join(" · "))}</td>
            <td>${escapeHtml(row.itemName || "—")}</td>
            <td>${escapeHtml(returnReasonLabel(row.reasonCode))}</td>
            <td>${escapeHtml(returnStatusLabel(row.status))}</td>
            <td>${escapeHtml(formatDate(row.createdAt))}</td>
            <td class="proc-ret-actions">${advanceBtn}${replaceBtn}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="enver-meta">Рекламацій немає</td></tr>`;

  const createForm = canManageProcurement()
    ? `<form class="proc-ret-form card" id="procReturnForm">
        <h3 class="proc-section-title">Нова рекламація</h3>
        <div class="proc-mto-form-grid">
          <label>id позиції<input name="positionId" type="number" required /></label>
          <label>id рядка закупівлі<input name="procurementItemId" type="number" placeholder="необовʼязково" /></label>
          <label>Причина
            <select name="reasonCode">
              <option value="defect">Дефект</option>
              <option value="wrong_size">Невірний розмір</option>
              <option value="wrong_decor">Невірний декор</option>
              <option value="transport_damage">Пошкодження</option>
              <option value="other">Інше</option>
            </select>
          </label>
          <label class="proc-ret-desc">Опис<textarea name="description" rows="2"></textarea></label>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Створити</button>
      </form>`
    : "";

  return `
    <div class="proc-returns">
      ${createForm}
      <div class="card proc-table-wrap">
        <table class="cp-parts-table">
          <thead><tr>
            <th>Позиція</th><th>Матеріал</th><th>Причина</th><th>Статус</th><th>Створено</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function bindProcurementReturns(root, { onRefresh } = {}) {
  if (!root) return;

  root.querySelector("#procReturnForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      await api.createProcurementReturn({
        positionId: Number(body.positionId),
        procurementItemId: body.procurementItemId ? Number(body.procurementItemId) : null,
        reasonCode: body.reasonCode,
        description: body.description || ""
      });
      const { toastSuccess, toastError } = await import("./toast.js");
      toastSuccess("Рекламацію створено");
      e.target.reset();
      await loadProcurementReturns();
      onRefresh?.();
    } catch (err) {
      const { toastError } = await import("./toast.js");
      toastError(err.message);
    }
  });

  root.querySelectorAll("[data-ret-advance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.updateProcurementReturnStatus(Number(btn.dataset.retAdvance), {
          status: btn.dataset.retNext
        });
        await loadProcurementReturns();
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });

  root.querySelectorAll("[data-ret-replace]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.updateProcurementReturnStatus(Number(btn.dataset.retReplace), {
          orderReplacement: true
        });
        const { toastSuccess, toastError } = await import("./toast.js");
        toastSuccess("Замовлення заміни створено");
        await loadProcurementReturns();
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });
}
