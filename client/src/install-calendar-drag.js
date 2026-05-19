import { api } from "./api.js";
import { canEditPositions } from "./auth.js";
import { formatUaDate, fromIsoDate, toIsoDate } from "./install-calendar-dates.js";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  GRID_HEIGHT_PX,
  SNAP_MIN,
  clampMinutes,
  heightPxForRange,
  minutesFromPointerY,
  minutesToTime,
  snapMinutes,
  topPxForMinutes
} from "./install-calendar-times.js";
import { state } from "./state.js";
import { runSave } from "./save-flow.js";

function findColumnAt(root, clientX) {
  const cols = root.querySelectorAll(".ical-time-col[data-drop-day]");
  for (const col of cols) {
    const r = col.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) return col;
  }
  return null;
}

function applyEventGeometry(el, startMin, endMin) {
  el.style.top = `${topPxForMinutes(startMin)}px`;
  el.style.height = `${heightPxForRange(startMin, endMin)}px`;
  el.dataset.startMin = String(startMin);
  el.dataset.endMin = String(endMin);
  const label = el.querySelector(".ical-timed-label");
  if (label) {
    label.textContent = `${minutesToTime(startMin)} – ${minutesToTime(endMin)} · ${label.dataset.title || ""}`;
  }
}

async function persistInstall(positionId, isoDay, startMin, endMin) {
  const updated = await api.patchPositionInstall(positionId, {
    installDate: formatUaDate(fromIsoDate(isoDay)),
    installTimeStart: minutesToTime(startMin),
    installTimeEnd: minutesToTime(endMin)
  });
  const idx = state.positions.findIndex((p) => p.id === positionId);
  if (idx >= 0) state.positions[idx] = updated;
  return updated;
}

export function bindTimedCalendarDrag(root, { onSaved, onOpenEdit }) {
  if (!canEditPositions() || !root) return;

  let mode = null;
  let el = null;
  let col = null;
  let startY = 0;
  let origStart = 0;
  let origEnd = 0;
  let moved = false;

  const endDrag = async () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (!el || !col) return;

    try {
      el.releasePointerCapture?.(el.dataset.pointerId);
    } catch {
      /* ignore */
    }
    el.classList.remove("ical-timed-event--active");
    const positionId = Number(el.dataset.installEvent);
    const isoDay = col.dataset.dropDay;
    const startMin = Number(el.dataset.startMin);
    const endMin = Number(el.dataset.endMin);

    el = null;
    col = null;
    mode = null;

    if (!moved) return;
    moved = false;

    await runSave("Монтаж", {
      saveFn: () => persistInstall(positionId, isoDay, startMin, endMin),
      successMessage: "Час монтажу збережено",
      onSuccess: () => onSaved?.(),
      onError: () => window.__enverRender?.({ contentOnly: true })
    }).catch(() => {});
  };

  const onMove = (e) => {
    if (!el || !col) return;
    const inner = col.querySelector(".ical-time-col-inner");
    if (!inner) return;

    if (mode === "resize") {
      let endMin = minutesFromPointerY(inner, e.clientY);
      endMin = Math.max(endMin, origStart + SNAP_MIN);
      endMin = clampMinutes(endMin);
      applyEventGeometry(el, origStart, endMin);
      moved = true;
      return;
    }

    if (mode === "move") {
      const deltaPx = e.clientY - startY;
      const deltaMin = snapMinutes(Math.round(deltaPx / 1.35));
      let startMin = origStart + deltaMin;
      let endMin = origEnd + deltaMin;
      const duration = origEnd - origStart;

      if (startMin < DAY_START_MIN) {
        startMin = DAY_START_MIN;
        endMin = startMin + duration;
      }
      if (endMin > DAY_END_MIN) {
        endMin = DAY_END_MIN;
        startMin = endMin - duration;
      }

      const hitCol = findColumnAt(root, e.clientX);
      if (hitCol) col = hitCol;

      applyEventGeometry(el, startMin, endMin);
      moved = true;
    }
  };

  const onUp = (e) => {
    if (!moved && mode === "move" && el) {
      onOpenEdit?.(Number(el.dataset.installEvent));
    }
    endDrag();
  };

  root.querySelectorAll(".ical-timed-event").forEach((eventEl) => {
    const handle = eventEl.querySelector("[data-resize-handle]");
    eventEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-resize-handle]")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      mode = "move";
      el = eventEl;
      col = eventEl.closest(".ical-time-col");
      startY = e.clientY;
      origStart = Number(eventEl.dataset.startMin);
      origEnd = Number(eventEl.dataset.endMin);
      moved = false;
      eventEl.classList.add("ical-timed-event--active");
      eventEl.dataset.pointerId = String(e.pointerId);
      eventEl.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    handle?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      e.preventDefault();
      mode = "resize";
      el = eventEl;
      col = eventEl.closest(".ical-time-col");
      origStart = Number(eventEl.dataset.startMin);
      origEnd = Number(eventEl.dataset.endMin);
      moved = false;
      eventEl.classList.add("ical-timed-event--active");
      handle.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });

  root.querySelectorAll(".ical-time-col-inner").forEach((inner) => {
    inner.addEventListener("dblclick", (e) => {
      if (e.target.closest(".ical-timed-event")) return;
      const colEl = inner.closest(".ical-time-col");
      const iso = colEl?.dataset.dropDay;
      if (!iso) return;
      const startMin = minutesFromPointerY(inner, e.clientY);
      const endMin = Math.min(startMin + 180, DAY_END_MIN);
      window.__enverOpenInstallSchedule?.({ isoDay: iso, startMin, endMin });
    });
  });
}

export { GRID_HEIGHT_PX };
