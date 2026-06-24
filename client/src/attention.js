import {
  deriveNextAction,
  collectBlockers,
  collectWarnings
} from "@enver/shared/production/next-action.js";
import { activePositions } from "./archive.js";
import { positionsForOrder, orderMissingNextAssignment } from "./workflows.js";

export { deriveNextAction, collectBlockers, collectWarnings };

const SEVERITY_RANK = { critical: 0, high: 1, normal: 2 };

/** Усі елементи, що потребують уваги (позиції). */
export function collectAttentionItems(positions, orders = []) {
  const items = [];

  for (const p of positions) {
    const blockers = p.blockers?.length ? p.blockers : collectBlockers(p);
    const warnings = p.warnings?.length ? p.warnings : collectWarnings(p);
    const nextAction = p.nextAction || deriveNextAction(p);

    for (const b of blockers) {
      items.push({
        kind: "blocker",
        severity: b.severity || "high",
        positionId: p.id,
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        item: p.item,
        object: p.object,
        stageKey: b.stageKey,
        message: b.message,
        code: b.code
      });
    }

    for (const w of warnings) {
      if (w.code === "overdue" && blockers.some((b) => b.code === "problem")) continue;
      items.push({
        kind: "warning",
        severity: w.severity || "normal",
        positionId: p.id,
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        item: p.item,
        object: p.object,
        stageKey: w.stageKey,
        message: w.message,
        code: w.code
      });
    }

    if (!blockers.length && nextAction?.type === "advance" && nextAction.stageKey) {
      items.push({
        kind: "next",
        severity: "normal",
        positionId: p.id,
        orderId: p.orderId,
        orderNumber: p.orderNumber,
        item: p.item,
        object: p.object,
        stageKey: nextAction.stageKey,
        message: nextAction.label,
        code: nextAction.actionKey
      });
    }
  }

  for (const order of orders) {
    if (orderMissingNextAssignment(order, positions)) {
      items.push({
        kind: "blocker",
        severity: "high",
        orderId: order.id,
        orderNumber: order.orderNumber,
        item: "",
        object: order.object,
        message: `Замовлення ${order.orderNumber}: не призначено відповідального`,
        code: "order_assignment"
      });
    }
  }

  return items.sort((a, b) => {
    const rank = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (rank !== 0) return rank;
    if (a.kind === "blocker" && b.kind !== "blocker") return -1;
    if (b.kind === "blocker" && a.kind !== "blocker") return 1;
    return String(a.orderNumber).localeCompare(String(b.orderNumber), "uk");
  });
}

export function countAttentionItems(positions, orders = []) {
  return collectAttentionItems(positions, orders).filter((i) => i.kind !== "next").length;
}

export function aggregateOrderAttention(order, positions) {
  const related = positionsForOrder(order, positions);
  const items = collectAttentionItems(related);
  const blockers = items.filter((i) => i.kind === "blocker");
  const warnings = items.filter((i) => i.kind === "warning");
  const maxOverdue = related.reduce((m, p) => Math.max(m, Number(p.overdueDays) || 0), 0);
  const hasProblem = related.some((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const root = related.find((p) => !p.parentId);
  const nextAction = root?.nextAction || (root ? deriveNextAction(root) : null);

  return {
    blockers,
    warnings,
    attentionCount: blockers.length + warnings.length,
    maxOverdue,
    hasProblem,
    positionCount: related.filter((p) => !p.parentId).length,
    nextAction,
    needsAssignment: orderMissingNextAssignment(order, positions)
  };
}

export function attentionFromState(state) {
  const positions = activePositions(state.positions, state.orders);
  return collectAttentionItems(positions, state.orders);
}
