import {
  getWorkPositions,
  workflowPositionsForOrders
} from "@enver/shared/production/order-position-model.js";
import { buildPositionGodmode } from "@enver/shared/production/godmode.js";
import { activePositions } from "./archive.js";
import { positionsForOrder, orderMissingNextAssignment } from "./workflows.js";

const SEVERITY_RANK = { critical: 0, high: 1, warning: 1, normal: 2 };

function positionGodmodeFields(p) {
  if (p.godmode) {
    return {
      blockers: p.godmode.blockers.map((b) => ({
        severity: "high",
        message: b.message,
        code: b.type,
        stageKey: b.stageKey
      })),
      warnings: p.godmode.warnings.map((w) => ({
        severity: w.level || "warning",
        message: w.message,
        code: w.type,
        stageKey: w.stageKey
      })),
      nextAction: p.godmode.nextAction,
      attentionScore: p.godmode.attentionScore || 0
    };
  }
  const gm = buildPositionGodmode(p);
  return {
    blockers: gm.blockers.map((b) => ({
      severity: "high",
      message: b.message,
      code: b.type,
      stageKey: b.stageKey
    })),
    warnings: gm.warnings.map((w) => ({
      severity: w.level || "warning",
      message: w.message,
      code: w.type,
      stageKey: w.stageKey
    })),
    nextAction: gm.nextAction,
    attentionScore: gm.attentionScore || 0
  };
}

/** Усі елементи, що потребують уваги (позиції). */
export function collectAttentionItems(positions, orders = []) {
  const items = [];
  const workflow = workflowPositionsForOrders(orders, positions);

  for (const p of workflow) {
    const gmFields = positionGodmodeFields(p);
    const blockers = gmFields.blockers;
    const warnings = gmFields.warnings;
    const nextAction = gmFields.nextAction || p.nextAction;
    const attentionScore = gmFields.attentionScore;

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
        code: b.code,
        attentionScore
      });
    }

    for (const w of warnings) {
      if (
        w.code === "overdue" &&
        blockers.some((b) => b.code === "problem" || b.code === "operator_problem")
      )
        continue;
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
        code: w.code,
        attentionScore
      });
    }

    if (!blockers.length && nextAction?.type && nextAction.type !== "resolve_problem") {
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
        code: nextAction.type,
        attentionScore
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
        code: "order_assignment",
        attentionScore: 80
      });
    }
  }

  return items.sort((a, b) => {
    const scoreDiff = (b.attentionScore || 0) - (a.attentionScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
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
  const nextAction = root?.nextAction || (root ? buildPositionGodmode(root).nextAction : null);

  return {
    blockers,
    warnings,
    attentionCount: blockers.length + warnings.length,
    maxOverdue,
    hasProblem,
    positionCount: getWorkPositions(order, related).length,
    nextAction,
    needsAssignment: orderMissingNextAssignment(order, positions)
  };
}

export function attentionFromState(state) {
  const positions = activePositions(state.positions, state.orders);
  return collectAttentionItems(positions, state.orders);
}
