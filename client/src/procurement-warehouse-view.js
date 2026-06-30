import { api } from "./api.js";
import { canManageProcurement, canReceiveWarehouse } from "./auth.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { mtoCategoryLabel } from "@enver/shared/production/procurement.js";
import { procurementStatusLabel } from "@enver/shared/production/constructive-package.js";
import { findLibraryItemByName, materialLibraryDatalistHtml } from "./material-library-view.js";

export async function loadWarehousePending() {
  const proc = state.procurement;
  proc.warehouseLoading = true;
  try {
    proc.warehousePending = await api.listWarehousePending({ days: 14 });
    proc.warehouseMovements = await api.listWarehouseMovements({ limit: 30 });
    return proc.warehousePending;
  } finally {
    proc.warehouseLoading = false;
  }
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("uk-UA");
}

export function renderProcurementWarehouse() {
  const proc = state.procurement || {};
  if (proc.warehouseLoading && !proc.warehousePending?.length) {
    return `<div class="enver-meta">Завантаження надходжень…</div>`;
  }

  const pending = proc.warehousePending || [];
  const rows = pending.length
    ? pending
        .map((row) => {
          const receiveBtn = canReceiveWarehouse()
            ? `<button type="button" class="btn btn-sm btn-primary" data-wh-receive="${row.id}">Прийняти</button>`
            : "";
          return `<tr>
            <td>${escapeHtml([row.orderNumber, row.positionItem].filter(Boolean).join(" · "))}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(mtoCategoryLabel(row.category))}</td>
            <td>${escapeHtml(formatDate(row.expectedDeliveryDate))}</td>
            <td>${escapeHtml(row.qty)} ${escapeHtml(row.unit || "")}</td>
            <td>${escapeHtml(row.supplier || "—")}</td>
            <td>${receiveBtn}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="enver-meta">Немає очікуваних надходжень</td></tr>`;

  const movements = (proc.warehouseMovements || [])
    .slice(0, 20)
    .map(
      (m) => `<tr>
        <td>${escapeHtml(formatDate(m.createdAt))}</td>
        <td>${escapeHtml(m.movementType)}</td>
        <td>${escapeHtml(m.itemName || "—")}</td>
        <td>${escapeHtml(m.qty)}</td>
        <td>${escapeHtml(m.location || "—")}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="proc-wh">
      <section class="card proc-wh-pending">
        <h3 class="proc-section-title">Очікувані надходження</h3>
        <div class="proc-table-wrap">
          <table class="cp-parts-table">
            <thead><tr>
              <th>Позиція</th><th>Матеріал</th><th>Категорія</th><th>Дата</th><th>Кількість</th><th>Постачальник</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
      <section class="card proc-wh-movements">
        <h3 class="proc-section-title">Останні рухи складу</h3>
        <div class="proc-table-wrap">
          <table class="cp-parts-table">
            <thead><tr><th>Час</th><th>Тип</th><th>Матеріал</th><th>К-ть</th><th>Комірка</th></tr></thead>
            <tbody>${movements || `<tr><td colspan="5" class="enver-meta">Ще немає рухів</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>`;
}

export function bindProcurementWarehouse(root, { onRefresh } = {}) {
  if (!root || !canReceiveWarehouse()) return;

  root.querySelectorAll("[data-wh-receive]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = Number(btn.dataset.whReceive);
      const location = window.prompt("Комірка складу (необовʼязково)", "") ?? "";
      try {
        await api.receiveProcurementItem(itemId, { location });
        const { toastSuccess } = await import("./toast.js");
        toastSuccess("Матеріал прийнято на склад");
        await loadWarehousePending();
        onRefresh?.();
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  });
}

export async function loadProcurementMto({ filter } = {}) {
  const proc = state.procurement;
  if (filter) proc.mtoFilter = filter;
  proc.mtoLoading = true;
  try {
    proc.mtoItems = await api.listProcurementMto({ filter: proc.mtoFilter || "open" });
    return proc.mtoItems;
  } finally {
    proc.mtoLoading = false;
  }
}

const MTO_FILTERS = [
  { key: "open", label: "Відкриті" },
  { key: "no_date", label: "Без дати" },
  { key: "overdue", label: "Прострочені" },
  { key: "all", label: "Усі" }
];

export function renderProcurementMto() {
  const proc = state.procurement || {};
  const filter = proc.mtoFilter || "open";
  const items = proc.mtoItems || [];

  const filterBtns = MTO_FILTERS.map(
    (f) =>
      `<button type="button" class="enver-segmented-btn ${filter === f.key ? "active" : ""}" data-mto-filter="${f.key}">${escapeHtml(f.label)}</button>`
  ).join("");

  const rows = items.length
    ? items
        .map(
          (row) => `<tr class="proc-mto-row" data-mto-item="${row.id}">
            <td>${escapeHtml([row.orderNumber, row.positionItem].filter(Boolean).join(" · "))}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(mtoCategoryLabel(row.category))}</td>
            <td>${escapeHtml(row.expectedDeliveryDate || "—")}</td>
            <td>${escapeHtml(row.requiredByDate || "—")}</td>
            <td>${escapeHtml(procurementStatusLabel(row.status))}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="enver-meta">Немає MTO-позицій</td></tr>`;

  const addForm = canManageProcurement()
    ? `<form class="proc-mto-form card" id="procMtoForm">
        <h3 class="proc-section-title">Додати матеріал під замовлення</h3>
        <p class="enver-meta">Оберіть з бібліотеки або введіть вручну — поля заповняться автоматично.</p>
        <div class="proc-mto-form-grid">
          <label>Позиція (id)<input name="positionId" type="number" required placeholder="id позиції" /></label>
          <label>Назва<input name="name" id="procMtoName" required placeholder="Фасад AGT…" list="materialLibraryDatalist" autocomplete="off" /></label>
          <label>Категорія
            <select name="category" id="procMtoCategory">
              <option value="facade_agt">Фасади AGT</option>
              <option value="facade_veneer">Фасади шпон</option>
              <option value="facade_painted">Фасади фарбовані</option>
              <option value="sliding_system">Розсувна система</option>
              <option value="mirror">Дзеркало</option>
              <option value="glass">Скло</option>
              <option value="stone">Камінь</option>
              <option value="custom">Під замовлення</option>
            </select>
          </label>
          <label>Кількість<input name="qty" value="1" /></label>
          <label>Од.<input name="unit" id="procMtoUnit" value="шт" /></label>
          <label>Дата поставки<input name="expectedDeliveryDate" type="date" /></label>
          <label>Потрібно в цех<input name="requiredByDate" type="date" /></label>
          <label>Постачальник<input name="supplier" id="procMtoSupplier" /></label>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Додати</button>
        ${materialLibraryDatalistHtml(proc.materialLibrary || [])}
      </form>`
    : "";

  return `
    <div class="proc-mto">
      <div class="enver-segmented proc-mto-filters">${filterBtns}</div>
      ${addForm}
      <div class="card proc-table-wrap">
        <table class="cp-parts-table">
          <thead><tr>
            <th>Позиція</th><th>Матеріал</th><th>Категорія</th><th>Поставка</th><th>Потрібно</th><th>Статус</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function bindProcurementMto(root, { onRefresh, onOpenPosition } = {}) {
  if (!root) return;

  root.querySelectorAll("[data-mto-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadProcurementMto({ filter: btn.dataset.mtoFilter });
      onRefresh?.();
    });
  });

  root.querySelectorAll(".proc-mto-row").forEach((row) => {
    row.addEventListener("dblclick", () => {
      const item = (state.procurement?.mtoItems || []).find(
        (i) => i.id === Number(row.dataset.mtoItem)
      );
      if (item?.positionId) onOpenPosition?.(item.positionId);
    });
  });

  const applyLibraryToMtoForm = (name) => {
    const lib = findLibraryItemByName(name, state.procurement?.materialLibrary || []);
    if (!lib) return;
    const cat = root.querySelector("#procMtoCategory");
    const unit = root.querySelector("#procMtoUnit");
    const supplier = root.querySelector("#procMtoSupplier");
    if (cat && lib.category) cat.value = lib.category;
    if (unit && lib.unit) unit.value = lib.unit;
    if (supplier && lib.supplier) supplier.value = lib.supplier;
  };

  root.querySelector("#procMtoName")?.addEventListener("change", (e) => {
    applyLibraryToMtoForm(e.target.value);
  });
  root.querySelector("#procMtoName")?.addEventListener("blur", (e) => {
    applyLibraryToMtoForm(e.target.value);
  });

  root.querySelector("#procMtoForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      await api.addProcurementMto(Number(body.positionId), {
        name: body.name,
        category: body.category,
        qty: body.qty,
        unit: body.unit,
        expectedDeliveryDate: body.expectedDeliveryDate || null,
        requiredByDate: body.requiredByDate || null,
        supplier: body.supplier || ""
      });
      const { toastSuccess } = await import("./toast.js");
      toastSuccess("MTO додано");
      e.target.reset();
      await loadProcurementMto();
      onRefresh?.();
    } catch (err) {
      const { toastError } = await import("./toast.js");
      toastError(err.message);
    }
  });
}
