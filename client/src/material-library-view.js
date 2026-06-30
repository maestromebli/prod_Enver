import { api } from "./api.js";
import { canManageProcurement } from "./auth.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import {
  MATERIAL_LIBRARY_ITEM_TYPES,
  materialItemTypeLabel
} from "@enver/shared/production/material-library.js";
import { mtoCategoryLabel } from "@enver/shared/production/procurement.js";

const TYPE_FILTERS = [
  { key: "", label: "Усі типи" },
  ...MATERIAL_LIBRARY_ITEM_TYPES.map((t) => ({
    key: t,
    label: materialItemTypeLabel(t)
  }))
];

export async function loadMaterialLibrary({ search, type, activeOnly = true } = {}) {
  const proc = state.procurement;
  proc.materialLibraryLoading = true;
  try {
    if (search !== undefined) proc.materialLibrarySearch = search;
    if (type !== undefined) proc.materialLibraryType = type;
    proc.materialLibrary = await api.listMaterialLibrary({
      search: proc.materialLibrarySearch || "",
      type: proc.materialLibraryType || "",
      active: activeOnly
    });
    return proc.materialLibrary;
  } finally {
    proc.materialLibraryLoading = false;
  }
}

function renderForm(editItem = null) {
  if (!canManageProcurement()) return "";

  const v = (field, fallback = "") => (editItem ? (editItem[field] ?? fallback) : fallback);

  const typeOptions = MATERIAL_LIBRARY_ITEM_TYPES.map(
    (t) =>
      `<option value="${escapeHtml(t)}" ${v("itemType") === t ? "selected" : ""}>${escapeHtml(materialItemTypeLabel(t))}</option>`
  ).join("");

  const categoryOptions = [
    "facade_agt",
    "facade_veneer",
    "facade_painted",
    "sliding_system",
    "mirror",
    "glass",
    "stone",
    "custom"
  ]
    .map(
      (c) =>
        `<option value="${c}" ${v("category") === c ? "selected" : ""}>${escapeHtml(mtoCategoryLabel(c))}</option>`
    )
    .join("");

  return `
    <form class="mat-lib-form card" id="materialLibraryForm" data-edit-id="${editItem?.id || ""}">
      <h3 class="proc-section-title">${editItem ? "Редагувати матеріал" : "Новий матеріал у бібліотеці"}</h3>
      <div class="proc-mto-form-grid mat-lib-form-grid">
        <label>Назва<input name="name" required value="${escapeHtml(v("name"))}" placeholder="ДСП 18 білий…" /></label>
        <label>Артикул<input name="article" value="${escapeHtml(v("article"))}" /></label>
        <label>Тип
          <select name="itemType">${typeOptions}</select>
        </label>
        <label>Категорія MTO
          <select name="category">
            <option value="">—</option>
            ${categoryOptions}
          </select>
        </label>
        <label>Матеріал<input name="material" value="${escapeHtml(v("material"))}" placeholder="ДСП, МДФ…" /></label>
        <label>Товщина<input name="thickness" value="${escapeHtml(v("thickness"))}" placeholder="18" /></label>
        <label>Декор<input name="decor" value="${escapeHtml(v("decor"))}" /></label>
        <label>Од.<input name="unit" value="${escapeHtml(v("unit", "шт"))}" /></label>
        <label>Постачальник<input name="supplier" value="${escapeHtml(v("supplier"))}" /></label>
        <label>Ціна план, UAH<input name="estimatedPrice" type="number" step="0.01" min="0" value="${v("estimatedPrice", 0)}" /></label>
        <label class="mat-lib-notes">Примітка<textarea name="notes" rows="2">${escapeHtml(v("notes"))}</textarea></label>
      </div>
      <div class="mat-lib-form-actions">
        <button type="submit" class="btn btn-primary btn-sm">${editItem ? "Зберегти" : "Додати"}</button>
        ${editItem ? `<button type="button" class="btn btn-sm" id="matLibCancelEdit">Скасувати</button>` : ""}
      </div>
    </form>`;
}

export function renderMaterialLibrary() {
  const proc = state.procurement || {};
  if (proc.materialLibraryLoading && !proc.materialLibrary?.length) {
    return `<div class="enver-meta">Завантаження бібліотеки…</div>`;
  }

  const typeFilter = proc.materialLibraryType || "";
  const search = proc.materialLibrarySearch || "";
  const items = proc.materialLibrary || [];
  const editing = proc.materialLibraryEdit;

  const filterBtns = TYPE_FILTERS.map(
    (f) =>
      `<button type="button" class="enver-segmented-btn ${typeFilter === f.key ? "active" : ""}" data-mat-lib-type="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`
  ).join("");

  const rows = items.length
    ? items
        .map(
          (row) => `<tr class="mat-lib-row" data-mat-lib-id="${row.id}">
            <td>${escapeHtml(materialItemTypeLabel(row.itemType))}</td>
            <td><strong>${escapeHtml(row.name)}</strong></td>
            <td><code>${escapeHtml(row.article || "—")}</code></td>
            <td>${escapeHtml([row.material, row.thickness, row.decor].filter(Boolean).join(" · ") || "—")}</td>
            <td>${escapeHtml(row.unit)}</td>
            <td>${escapeHtml(row.supplier || "—")}</td>
            <td>${row.estimatedPrice > 0 ? `${Number(row.estimatedPrice).toFixed(2)}` : "—"}</td>
            <td class="mat-lib-actions">
              ${
                canManageProcurement()
                  ? `<button type="button" class="btn btn-xs" data-mat-lib-edit="${row.id}">✎</button>
                     <button type="button" class="btn btn-xs btn-ghost proc-btn-danger" data-mat-lib-deactivate="${row.id}" title="Приховати">×</button>`
                  : ""
              }
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="8" class="enver-meta">Немає матеріалів — додайте першу позицію</td></tr>`;

  return `
    <div class="mat-lib">
      <p class="enver-meta mat-lib-intro">Каталог матеріалів для швидкого додавання в MTO та заявки закупівлі.</p>
      <div class="mat-lib-toolbar">
        <input type="search" class="mat-lib-search" id="matLibSearch" placeholder="Пошук назви, артикулу, постачальника…" value="${escapeHtml(search)}" />
        <div class="enver-segmented mat-lib-type-filters">${filterBtns}</div>
      </div>
      ${renderForm(editing)}
      <div class="card proc-table-wrap">
        <table class="cp-parts-table">
          <thead><tr>
            <th>Тип</th><th>Назва</th><th>Артикул</th><th>Матеріал</th><th>Од.</th><th>Постачальник</th><th>Ціна</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function bindMaterialLibrary(root, { onRefresh } = {}) {
  if (!root) return;

  let searchTimer = null;
  root.querySelector("#matLibSearch")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadMaterialLibrary({ search: e.target.value });
      onRefresh?.();
    }, 280);
  });

  root.querySelectorAll("[data-mat-lib-type]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadMaterialLibrary({ type: btn.dataset.matLibType || "" });
      onRefresh?.();
    });
  });

  root.querySelector("#matLibCancelEdit")?.addEventListener("click", () => {
    state.procurement.materialLibraryEdit = null;
    onRefresh?.();
  });

  root.querySelectorAll("[data-mat-lib-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.matLibEdit);
      const item = (state.procurement?.materialLibrary || []).find((i) => i.id === id);
      state.procurement.materialLibraryEdit = item || null;
      onRefresh?.();
    });
  });

  root.querySelectorAll("[data-mat-lib-deactivate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Приховати матеріал з бібліотеки?")) return;
      const { toastError, toastSuccess } = await import("./toast.js");
      try {
        await api.deactivateMaterialLibraryItem(Number(btn.dataset.matLibDeactivate));
        toastSuccess("Матеріал приховано");
        await loadMaterialLibrary();
        onRefresh?.();
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  root.querySelector("#materialLibraryForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManageProcurement()) return;
    const form = e.target;
    const editId = Number(form.dataset.editId) || null;
    const fd = new FormData(form);
    const body = {
      name: fd.get("name"),
      article: fd.get("article"),
      itemType: fd.get("itemType"),
      category: fd.get("category") || "",
      material: fd.get("material"),
      thickness: fd.get("thickness"),
      decor: fd.get("decor"),
      unit: fd.get("unit"),
      supplier: fd.get("supplier"),
      estimatedPrice: fd.get("estimatedPrice"),
      notes: fd.get("notes")
    };
    const { toastError, toastSuccess } = await import("./toast.js");
    try {
      if (editId) {
        await api.updateMaterialLibraryItem(editId, body);
        toastSuccess("Збережено");
      } else {
        await api.createMaterialLibraryItem(body);
        toastSuccess("Додано в бібліотеку");
      }
      state.procurement.materialLibraryEdit = null;
      await loadMaterialLibrary();
      onRefresh?.();
    } catch (err) {
      toastError(err.message);
    }
  });
}

/** Datalist HTML для автозаповнення в формах MTO. */
export function materialLibraryDatalistHtml(items = []) {
  if (!items.length) return "";
  const options = items
    .map(
      (i) =>
        `<option value="${escapeHtml(i.name)}" data-mat-id="${i.id}" label="${escapeHtml([i.article, i.supplier].filter(Boolean).join(" · "))}"></option>`
    )
    .join("");
  return `<datalist id="materialLibraryDatalist">${options}</datalist>`;
}

export function findLibraryItemByName(name, items = []) {
  const n = String(name || "")
    .trim()
    .toLowerCase();
  if (!n) return null;
  return (
    (items || []).find(
      (i) =>
        String(i.name || "")
          .trim()
          .toLowerCase() === n
    ) || null
  );
}
