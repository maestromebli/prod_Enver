import {
  getWorkPositions,
  getRootPositions
} from "@enver/shared/production/order-position-model.js";
import { api } from "./api.js";
import { expandPosition, togglePositionExpanded } from "./position-tree.js";
import { quickAdvancePosition } from "./positions.js";
import { runSave } from "./save-flow.js";
import { state } from "./state.js";
import { navigateGodmodeAction } from "./godmode-ui.js";
import {
  HANDOFF_ACTION_TYPES,
  UI_ACTION_TYPES
} from "@enver/shared/production/godmode-ui-helpers.js";
import { STAGES } from "./workflows.js";
import { loadPositionManagerBundle } from "./position-manager-panel.js";
import {
  bindPositionOrderTab,
  getPositionSubTab,
  loadPositionOrderTabData
} from "./position-order-tab.js";
import {
  bindOrder3DTab,
  loadOrder3DAsset,
  teardownOrder3DTab
} from "./order-3d/order-3d-bind.js";
import { focusOrderInlineAddInput, openPositionInOrderDetail } from "./order-detail-state.js";

async function patchPositionStage(positionId, stageKey, payload, onRefresh) {
  const stage = STAGES.find((s) => s.key === stageKey);
  const stageName = stage?.label || stageKey;

  await runSave(`Етап «${stageName}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(positionId, stageKey, payload);
      const idx = state.positions.findIndex((p) => p.id === positionId);
      if (idx >= 0) state.positions[idx] = updated;
      return updated;
    },
    successMessage: `«${stageName}»: ${payload.status}`,
    onSuccess: async () => {
      await onRefresh?.();
    }
  }).catch(() => {});
}

async function movePositionToStage(position, targetStageKey, onRefresh) {
  const stage = STAGES.find((s) => s.key === targetStageKey);
  if (!stage) return;

  if (stage.type === "constructor") {
    if (!position.hasConstructiveFile) {
      const { toastError } = await import("./toast.js");
      toastError("Спочатку завантажте конструктив у позиції");
      return;
    }
    await patchPositionStage(
      position.id,
      targetStageKey,
      stagePatchPayload(position, stage, "Передано"),
      onRefresh
    );
    return;
  }

  await patchPositionStage(
    position.id,
    targetStageKey,
    stagePatchPayload(position, stage, "В роботі"),
    onRefresh
  );
}

function stagePatchPayload(position, stage, status) {
  if (stage.type === "constructor") {
    return { status, constructor: position.constructor };
  }
  return { status, assemblyResponsible: position.assemblyResponsible };
}

async function inlineAddPosition(order, itemName, related, onRefresh) {
  const name = itemName.trim();
  if (!name) return;

  const root = related.find((p) => !p.parentId);
  const body = {
    item: name,
    orderNumber: order.orderNumber,
    orderId: order.id,
    object: order.object,
    manager: order.manager,
    itemType: "Зона"
  };

  if (root) {
    body.parentId = root.id;
  }

  await runSave("Позиція", {
    saveFn: async () => {
      const created = await api.createPosition(body);
      const { upsertPosition } = await import("./data-sync.js");
      upsertPosition(created);
      if (created.parentId) expandPosition(created.parentId);
      return created;
    },
    successMessage: `«${name}» додано`,
    onSuccess: async () => {
      await onRefresh?.();
    }
  }).catch(() => {});
}

function bindStepTrack(root, onRefresh) {
  root.querySelectorAll("[data-step-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.positionId);
      const targetStageKey = btn.dataset.stepJump;
      const position = state.positions.find((p) => p.id === positionId);
      if (!position || position.currentStage === targetStageKey) return;
      await movePositionToStage(position, targetStageKey, onRefresh);
    });
  });
}

function bindQuickAdvance(root, onRefresh) {
  root.querySelectorAll("[data-quick-advance]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.quickAdvance);
      const stageKey = btn.dataset.stage;
      await quickAdvancePosition(id, stageKey);
      await onRefresh?.();
    });
  });
}

export function bindOrderDetail(root, handlers = {}) {
  const { onBack, onRefresh, onOpenPosition, onEditOrder } = handlers;

  root.querySelector("[data-orders-back]")?.addEventListener("click", onBack);

  root.querySelectorAll("[data-order-detail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ordersView.detailTab = btn.dataset.orderDetailTab;
      const tabKey = btn.dataset.orderDetailTab || "";
      if (btn.dataset.posSubJump && tabKey.startsWith("pos-")) {
        const positionId = Number(tabKey.slice(4));
        state.ordersView.positionSubTab = {
          ...(state.ordersView.positionSubTab || {}),
          [positionId]: btn.dataset.posSubJump
        };
      }
      if (btn.dataset.focusResponsibles === "1" && tabKey.startsWith("pos-")) {
        state.ordersView.focusResponsiblesPositionId = Number(tabKey.slice(4));
      }
      onRefresh?.({ contentOnly: false });
      if (btn.dataset.focusInlineAdd) focusOrderInlineAddInput();
    });
  });

  root.querySelectorAll("[data-open-constructor-desk-order]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
      await openConstructorDeskForAssignment({
        orderId: Number(btn.dataset.openConstructorDeskOrder)
      });
    });
  });

  root.querySelectorAll("[data-open-constructor-desk-position]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.openConstructorDeskPosition);
      const wsTab = btn.dataset.constructorWsTab === "package" ? "package" : "work";
      if (wsTab === "package") {
        const { openConstructorWorkspace } = await import("./constructor-desk.js");
        await openConstructorWorkspace(positionId, { workspaceTab: "package" });
        return;
      }
      const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
      await openConstructorDeskForAssignment({ positionId });
    });
  });

  root.querySelector("[data-open-constructor-desk]")?.addEventListener("click", async () => {
    const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
    await openConstructorDeskForAssignment({ orderId: state.selectedOrderId });
  });

  const tab = state.ordersView.detailTab || "";
  if (tab === "model-3d") {
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (order) {
      loadOrder3DAsset(order.id)
        .then(() => {
          bindOrder3DTab(root, order, { onRefresh });
          onRefresh?.({ contentOnly: true });
        })
        .catch(() => bindOrder3DTab(root, order, { onRefresh }));
    }
  } else {
    teardownOrder3DTab();
  }

  if (tab.startsWith("pos-")) {
    const positionId = Number(tab.slice(4));
    const order = state.orders.find((o) => o.id === state.selectedOrderId) || {};
    const related = state.positions.filter(
      (p) => p.orderId === state.selectedOrderId || p.orderNumber === order.orderNumber
    );
    const position =
      getWorkPositions(order, related).find((p) => p.id === positionId) ||
      getRootPositions(order, related).find((p) => p.id === positionId) ||
      state.positions.find((p) => p.id === positionId);
    const subTab = getPositionSubTab(positionId);

    const bindTab = () => {
      const panel = root.querySelector(`[data-position-tab="${positionId}"]`) || root;
      if (!position) return;
      bindPositionOrderTab(panel, position, state.ordersView.positionBundles?.[positionId], {
        subTab,
        onRefresh,
        onOpenConstructor: async () => {
          const { openConstructorWorkspace } = await import("./constructor-desk.js");
          await openConstructorWorkspace(positionId);
        },
        onOpenPosition: (pid) => onOpenPosition?.(pid)
      });
    };

    const ensureDownstream = () => {
      if (subTab === "manager") {
        bindTab();
        return;
      }
      loadPositionOrderTabData(positionId, subTab)
        .then((data) => {
          state.ordersView.positionTabDownstream = {
            ...(state.ordersView.positionTabDownstream || {}),
            [positionId]: data
          };
          bindTab();
          onRefresh?.({ contentOnly: true });
        })
        .catch(() => bindTab());
    };

    if (!state.ordersView.positionBundles?.[positionId]) {
      loadPositionManagerBundle(positionId)
        .then((bundle) => {
          state.ordersView.positionBundles = {
            ...(state.ordersView.positionBundles || {}),
            [positionId]: bundle
          };
          ensureDownstream();
        })
        .catch(() => ensureDownstream());
    } else {
      ensureDownstream();
    }
  }

  root.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => onEditOrder?.(Number(btn.dataset.editOrder)));
  });

  root.querySelectorAll("[data-open-position]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.openPosition);
      if (openPositionInOrderDetail(id)) {
        onRefresh?.({ contentOnly: false });
      } else {
        onOpenPosition?.(id);
      }
    });
  });

  root.querySelectorAll("[data-open-position-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => onOpenPosition?.(Number(btn.dataset.openPositionDrawer)));
  });

  root.querySelectorAll("[data-toggle-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePositionExpanded(Number(btn.dataset.togglePosition));
      onRefresh?.({ contentOnly: true });
    });
  });

  const refresh = () => onRefresh?.({ contentOnly: true });
  bindStepTrack(root, refresh);
  bindQuickAdvance(root, refresh);

  root.querySelectorAll("[data-run-next-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.runNextAction);
      const actionType = btn.dataset.actionType;
      const position = state.positions.find((p) => p.id === positionId);

      if (position && !HANDOFF_ACTION_TYPES.has(actionType)) {
        if (actionType === "assign_constructor") {
          const { canManageConstructorDesk } = await import("./auth.js");
          if (canManageConstructorDesk()) {
            if (navigateGodmodeAction(position, actionType, state)) {
              await onRefresh?.({ contentOnly: false });
              return;
            }
          }
          const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
          await openConstructorDeskForAssignment({ positionId });
          return;
        }
        if (navigateGodmodeAction(position, actionType, state)) {
          await onRefresh?.({ contentOnly: false });
          return;
        }
        if (UI_ACTION_TYPES.has(actionType)) {
          onOpenPosition?.(positionId);
          return;
        }
      }

      await runSave("Наступна дія", {
        saveFn: () => api.runPositionNextAction(positionId, actionType),
        successMessage: "Дію виконано",
        onSuccess: async (updated) => {
          const idx = state.positions.findIndex((p) => p.id === positionId);
          if (idx >= 0) state.positions[idx] = updated;
          await onRefresh?.();
        }
      }).catch(() => {});
    });
  });

  root.querySelectorAll("[data-run-order-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = Number(btn.dataset.runOrderAction);
      const actionType = btn.dataset.actionType;
      await runSave("Замовлення", {
        saveFn: () => api.runOrderNextAction(orderId, actionType),
        successMessage: "Замовлення закрито",
        onSuccess: async (updated) => {
          const { upsertOrder, refreshAppData } = await import("./data-sync.js");
          upsertOrder(updated);
          try {
            await refreshAppData({ includeDirectories: false });
          } catch {
            /* локальний стан уже оновлено */
          }
          await onRefresh?.();
        }
      }).catch(() => {});
    });
  });

  const inlineForm = root.querySelector("#orderInlineAddForm");
  const inlineInput = root.querySelector("#orderInlineAddInput");
  inlineForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (!order) return;
    const related = state.positions.filter(
      (p) => p.orderId === order.id || p.orderNumber === order.orderNumber
    );
    const name = inlineInput?.value || "";
    await inlineAddPosition(order, name, related, onRefresh);
    if (inlineInput) inlineInput.value = "";
  });
}
