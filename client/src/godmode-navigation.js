import {
  canQuickRunGodmodeAction,
  orderDetailSubTabForGodmodeAction
} from "@enver/shared/production/godmode-ui-helpers.js";
import { canManageConstructorDesk } from "./auth.js";
import { resolvePositionGodmode } from "./godmode-ui.js";
import { state } from "./state.js";

/** Єдиний вхід: куди відкрити позицію за godmode-дією. */
export async function openGodmodePositionTarget(position, actionType) {
  if (!position?.id || !actionType) return { kind: "none" };

  if (actionType === "assign_constructor") {
    if (canManageConstructorDesk()) {
      const { openPositionInOrderDetail } = await import("./order-detail.js");
      if (openPositionInOrderDetail(position.id)) {
        state.ordersView.focusResponsiblesPositionId = position.id;
        return { kind: "order_detail", subTab: "responsibles" };
      }
    }
    const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
    await openConstructorDeskForAssignment({ positionId: position.id });
    return { kind: "constructor_desk", level: "assignment" };
  }

  if (actionType === "upload_constructive" || actionType === "upload_constructive_package") {
    const { openConstructiveWorkspace } = await import("./position-workspace.js");
    await openConstructiveWorkspace(position.id, { workspaceTab: "package" });
    return { kind: "constructor_desk", workspaceTab: "package" };
  }

  if (actionType === "parse_constructive_package") {
    const { canWorkConstructorDesk } = await import("./auth.js");
    const { requestAutoParsePackage } = await import("./constructive-package-parse-ui.js");
    if (canWorkConstructorDesk()) {
      const { openPositionInOrderDetail } = await import("./order-detail.js");
      requestAutoParsePackage(position.id);
      if (openPositionInOrderDetail(position.id, "constructive")) {
        return { kind: "order_detail", subTab: "constructive", autoParse: true };
      }
    }
    const { openConstructiveWorkspace } = await import("./position-workspace.js");
    await openConstructiveWorkspace(position.id, { workspaceTab: "package", autoParse: true });
    return { kind: "constructor_desk", workspaceTab: "package", autoParse: true };
  }

  if (actionType === "fill_manager_data") {
    const { openManagerDataWorkspace } = await import("./position-workspace.js");
    await openManagerDataWorkspace(position.id);
    return { kind: "edit_workspace", panel: "manager" };
  }

  const subTab = orderDetailSubTabForGodmodeAction(actionType);
  if (subTab) {
    const { openPositionInOrderDetail } = await import("./order-detail.js");
    if (openPositionInOrderDetail(position.id, subTab)) {
      return { kind: "order_detail", subTab };
    }
  }

  const { openPositionHub } = await import("./position-workspace.js");
  if (openPositionHub(position.id)) {
    return { kind: "order_detail", subTab: "manager" };
  }
  return { kind: "none" };
}

/**
 * Клік по позиції — завжди read-only hub у картці замовлення.
 * Godmode-дія веде до відповідного workspace.
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

  const { openPositionHub } = await import("./position-workspace.js");
  return openPositionHub(id);
}
