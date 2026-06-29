import { canEditPositionManagerData, canEditPositions, canWorkConstructorDesk } from "./auth.js";
import { openPositionInOrderDetail, focusOrderInlineAddInput } from "./order-detail-state.js";
import { state } from "./state.js";
import { expandPosition, getParentPosition } from "./position-tree.js";

/** Read-only hub: картка позиції у замовленні. */
export function openPositionHub(positionId, subTab = "manager") {
  return openPositionInOrderDetail(positionId, subTab);
}

/** Workspace редагування полів позиції (drawer). */
export async function openPositionEditWorkspace(positionId, { panel = "general" } = {}) {
  const id = Number(positionId);
  if (!Number.isFinite(id)) return false;
  let position = state.positions.find((p) => p.id === id);
  if (!position) {
    try {
      const { api } = await import("./api.js");
      const { upsertPosition } = await import("./data-sync.js");
      position = await api.getPosition(id);
      upsertPosition(position);
    } catch {
      return false;
    }
  }
  const { openPositionEditDrawer } = await import("./positions.js");
  await openPositionEditDrawer(position, { panel });
  return true;
}

/** Workspace даних менеджера (файли, дедлайни). */
export async function openManagerDataWorkspace(positionId) {
  return openPositionEditWorkspace(positionId, { panel: "manager" });
}

/** Workspace завантаження пакета конструктива. */
export async function openConstructiveWorkspace(positionId, options = {}) {
  const { openConstructorWorkspace } = await import("./constructor-desk.js");
  await openConstructorWorkspace(positionId, options);
}

/** Додавання підпозиції — лише inline у картці замовлення. */
export function openInlineAddPosition(parentId) {
  const parent = getParentPosition(parentId);
  if (!parent?.orderId) return false;
  expandPosition(parentId);
  state.selectedOrderId = parent.orderId;
  state.activeTab = "Замовлення";
  state.ordersView.detailTab = "positions";
  focusOrderInlineAddInput();
  return true;
}

export function renderPositionWorkspaceBar(position) {
  const parts = [];
  if (canEditPositions()) {
    parts.push(
      `<button type="button" class="btn btn-sm" data-edit-position-workspace="${position.id}">Редагувати позицію</button>`
    );
  }
  if (canEditPositionManagerData()) {
    parts.push(
      `<button type="button" class="btn btn-sm" data-edit-manager-workspace="${position.id}">Редагувати дані</button>`
    );
  }
  if (canWorkConstructorDesk()) {
    parts.push(
      `<button type="button" class="btn btn-sm btn-primary" data-open-constructor-ws="${position.id}">Стіл конструктора</button>`
    );
  }
  if (!parts.length) return "";
  return `<div class="order-position-workspaces">${parts.join("")}</div>`;
}

export function bindPositionWorkspaceBar(root) {
  root.querySelectorAll("[data-edit-position-workspace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void openPositionEditWorkspace(Number(btn.dataset.editPositionWorkspace));
    });
  });
  root.querySelectorAll("[data-edit-manager-workspace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void openManagerDataWorkspace(Number(btn.dataset.editManagerWorkspace));
    });
  });
}
