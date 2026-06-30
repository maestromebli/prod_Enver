import { state } from "./state.js";
import { stageClientField } from "./terminology.js";
import { api } from "./api.js";

function statusField() {
  return stageClientField(state.operatorStage);
}

function activeSessionPositionId() {
  return state.operatorActiveSession?.position_id ?? null;
}

function hasBlockingSession() {
  if (!activeSessionPositionId()) return false;
  const sess = state.operatorActiveSession;
  const status = sess?.stage_status;
  return status === "В роботі" || status === "На паузі";
}

export function pickNextQueuePosition() {
  const field = statusField();
  if (!field) return null;
  return (
    (state.operatorQueue || []).find((p) => {
      const st = p[field];
      return st === "Передано" || st === "Не розпочато";
    }) || null
  );
}

function canAutoStartSelected() {
  if (hasBlockingSession()) return false;
  const field = statusField();
  const pos = (state.operatorQueue || []).find((p) => p.id === state.operatorSelectedPositionId);
  if (!pos) return false;
  const st = pos[field];
  return st === "Передано" || st === "Не розпочато";
}

/**
 * Після завершення або завантаження черги — обрати наступну позицію.
 */
export async function autoSelectNextOperatorJob({ loadDetail } = {}) {
  const hints = state.operatorAutomation || {};
  if (hints.autoSelectNextJob === false) return false;
  if (hasBlockingSession()) return false;

  const next = pickNextQueuePosition();
  if (!next) {
    state.operatorSelectedPositionId = null;
    state.operatorJobDetail = null;
    return false;
  }

  state.operatorSelectedPositionId = next.id;
  if (loadDetail) await loadDetail(next.id);
  return true;
}

/**
 * Автостарт етапу після вибору позиції (якщо увімкнено в Settings).
 */
export async function maybeAutoStartOperatorJob({ onMutation } = {}) {
  const hints = state.operatorAutomation || {};
  if (hints.autoStartStageOnOpen === false) return false;
  if (!canAutoStartSelected()) return false;
  if (!state.currentUser?.id || !state.operatorSelectedPositionId || !state.operatorStage) {
    return false;
  }

  try {
    const result = await api.operatorStart({
      userId: state.currentUser.id,
      positionId: state.operatorSelectedPositionId,
      stageKey: state.operatorStage
    });
    await onMutation?.(result);
    return true;
  } catch {
    return false;
  }
}
