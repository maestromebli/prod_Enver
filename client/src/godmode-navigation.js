import {
  canQuickRunGodmodeAction,
  orderDetailSubTabForGodmodeAction,
  panelForGodmodeAction
} from "@enver/shared/production/godmode-ui-helpers.js";
import { canWorkConstructorDesk } from "./auth.js";
import { resolvePositionGodmode } from "./godmode-ui.js";
import { state } from "./state.js";

/** Єдиний вхід: куди відкрити позицію за godmode-дією. */
export async function openGodmodePositionTarget(position, actionType) {
  if (!position?.id || !actionType) return { kind: "none" };

  if (actionType === "assign_constructor") {
    const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
    await openConstructorDeskForAssignment({ positionId: position.id });
    return { kind: "constructor_desk", level: "assignment" };
  }

  if (actionType === "upload_constructive" || actionType === "upload_constructive_package") {
    if (canWorkConstructorDesk()) {
      const { openConstructorWorkspace } = await import("./constructor-desk.js");
      await openConstructorWorkspace(position.id, { workspaceTab: "package" });
      return { kind: "constructor_desk", workspaceTab: "package" };
    }
    const { openPositionInOrderDetail } = await import("./order-detail.js");
    if (openPositionInOrderDetail(position.id, "constructive")) {
      return { kind: "order_detail", subTab: "constructive" };
    }
    const { openPositionDrawer } = await import("./positions.js");
    openPositionDrawer(position, { panel: "constructive" });
    return { kind: "drawer", panel: "constructive" };
  }

  const subTab = orderDetailSubTabForGodmodeAction(actionType);
  if (subTab || actionType === "fill_manager_data") {
    const { openPositionInOrderDetail } = await import("./order-detail.js");
    if (openPositionInOrderDetail(position.id, subTab || "manager")) {
      return { kind: "order_detail", subTab: subTab || "manager" };
    }
  }

  const panel = panelForGodmodeAction(actionType) || "general";
  const { openPositionDrawer } = await import("./positions.js");
  openPositionDrawer(position, { panel });
  return { kind: "drawer", panel };
}

/**
 * Клік по позиції з контексту (дашборд, увага, цех, таблиця).
 * Спочатку картка замовлення / стіл конструктора, drawer — лише fallback.
 */
export async function openPositionFromContext(positionId, actionType = null) {
  const id = Number(positionId);
  if (!Number.isFinite(id)) return false;

  let position = state.positions.find((p) => p.id === id);
  if (!position) {
    try {
      const { api } = await import("./api.js");
      position = await api.getPosition(id);
      const { upsertPosition } = await import("./data-sync.js");
      upsertPosition(position);
    } catch {
      return false;
    }
  }

  const gm = resolvePositionGodmode(position);
  const effectiveAction = actionType || gm.nextAction?.type || null;

  if (effectiveAction && !canQuickRunGodmodeAction(effectiveAction)) {
    await openGodmodePositionTarget(position, effectiveAction);
    return true;
  }

  const { openPositionInOrderDetail } = await import("./order-detail.js");
  if (openPositionInOrderDetail(id)) {
    return true;
  }

  const { openPositionDrawer } = await import("./positions.js");
  const panel =
    effectiveAction && !canQuickRunGodmodeAction(effectiveAction)
      ? panelForGodmodeAction(effectiveAction) || "general"
      : "general";
  openPositionDrawer(position, { panel });
  return true;
}
