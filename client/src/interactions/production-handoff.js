import { canRunNextAction } from "@enver/shared/production/godmode.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { resolvePositionGodmode } from "../godmode-ui.js";

const HANDOFF_TYPES = new Set([
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
  "handoff_to_packaging",
  "ready_for_install"
]);

/**
 * Чи дозволено перетягнути позицію в колонку targetStageKey.
 * Використовує ту саму godmode-логіку, що й кнопки handoff.
 */
export function resolveProductionDrop(position, targetStageKey, user) {
  if (!position || !targetStageKey) {
    return { ok: false, reason: "Невідома ціль" };
  }

  const current = position.currentStage || "constructor";
  if (current === targetStageKey) {
    return { ok: true, noop: true };
  }

  const gm = resolvePositionGodmode(position);
  const next = gm.nextAction;
  if (!next?.type) {
    return { ok: false, reason: "Немає доступної дії для цієї позиції" };
  }

  if (HANDOFF_TYPES.has(next.type) && next.stageKey === targetStageKey) {
    const check = canRunNextAction(position, next, user);
    if (check.allowed !== false && next.allowed !== false) {
      return { ok: true, actionType: next.type, label: next.label || stageLabel(targetStageKey) };
    }
    return { ok: false, reason: check.reason || next.reason || "Дію заборонено" };
  }

  if (next.type === "advance_stage" && next.stageKey === current) {
    return {
      ok: false,
      reason: next.reason || `Спочатку завершіть етап «${stageLabel(current)}»`
    };
  }

  return {
    ok: false,
    reason: "Цю позицію ще не можна передати на цей етап."
  };
}

export function canDropOnStage(position, targetStageKey, user) {
  const r = resolveProductionDrop(position, targetStageKey, user);
  return r.ok && !r.noop;
}
