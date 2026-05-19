import { api } from "./api.js";
import { canEditPositions } from "./auth.js";
import { addDays, formatUaDate, fromIsoDate, toIsoDate } from "./install-calendar-dates.js";
import { dayCount } from "./install-calendar-days.js";
import { state } from "./state.js";
import { toastError } from "./toast.js";

const ROW_H = 36;

export { ROW_H };

async function persistInstallDays(positionId, installDate, installEndDate) {
  const updated = await api.patchPositionInstall(positionId, {
    installDate,
    installEndDate,
    installTimeStart: "",
    installTimeEnd: ""
  });
  const idx = state.positions.findIndex((p) => p.id === positionId);
  if (idx >= 0) state.positions[idx] = updated;
  return updated;
}

function colFromPointer(colsContainer, clientX) {
  const cols = [...colsContainer.querySelectorAll(".ical-week-col[data-drop-day]")];
  for (let i = 0; i < cols.length; i += 1) {
    const r = cols[i].getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) return { col: cols[i], index: i };
  }
  return null;
}

export function bindDayCalendarDrag(root, { onSaved, onOpenEdit }) {
  if (!canEditPositions() || !root) return;

  let mode = null;
  let el = null;
  let origStartIso = "";
  let origEndIso = "";
  let durationDays = 1;
  let moved = false;

  const applyBarGeometry = (bar, colStart, colLen) => {
    const pct = 100 / 7;
    bar.style.left = `${colStart * pct}%`;
    bar.style.width = `${colLen * pct}%`;
    bar.dataset.colStart = String(colStart);
    bar.dataset.colLen = String(colLen);
  };

  const endDrag = async () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (!el) return;
    el.classList.remove("ical-span-event--active");

    const positionId = Number(el.dataset.installEvent);
    const startIso = el.dataset.startIso;
    const endIso = el.dataset.endIso;
    el = null;
    mode = null;

    if (!moved) return;
    moved = false;

    try {
      await persistInstallDays(
        positionId,
        formatUaDate(fromIsoDate(startIso)),
        formatUaDate(fromIsoDate(endIso))
      );
      await onSaved?.();
    } catch (err) {
      toastError(err.message);
      window.__enverRender?.({ contentOnly: true });
    }
  };

  const onMove = (e) => {
    if (!el) return;
    const week = el.closest(".ical-week-board");
    const colsWrap = week?.querySelector(".ical-week-cols");
    if (!colsWrap) return;

    if (mode === "resize") {
      const hit = colFromPointer(colsWrap, e.clientX);
      if (!hit) return;
      const colStart = Number(el.dataset.colStart);
      const start = fromIsoDate(origStartIso);
      const endCol = hit.index;
      const weekStart = fromIsoDate(colsWrap.dataset.weekStart);
      const newEnd = addDays(weekStart, endCol);
      if (newEnd < start) return;
      const colLen = dayCount(start, newEnd);
      const weekDays = 7;
      const spanStart = Math.round((start - weekStart) / 86400000);
      applyBarGeometry(el, spanStart, Math.min(colLen, weekDays - spanStart));
      el.dataset.endIso = toIsoDate(newEnd);
      moved = true;
      return;
    }

    if (mode === "move") {
      const hit = colFromPointer(colsWrap, e.clientX);
      if (!hit) return;
      const weekStart = fromIsoDate(colsWrap.dataset.weekStart);
      const newStart = addDays(weekStart, hit.index);
      const newEnd = addDays(newStart, durationDays - 1);
      const colStart = hit.index;
      applyBarGeometry(el, colStart, durationDays);
      el.dataset.startIso = toIsoDate(newStart);
      el.dataset.endIso = toIsoDate(newEnd);
      moved = true;
    }
  };

  const onUp = () => {
    if (!moved && el) onOpenEdit?.(Number(el.dataset.installEvent));
    endDrag();
  };

  root.querySelectorAll(".ical-span-event").forEach((bar) => {
    const handle = bar.querySelector("[data-resize-day]");
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-resize-day]")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      mode = "move";
      el = bar;
      origStartIso = bar.dataset.startIso;
      origEndIso = bar.dataset.endIso;
      durationDays = dayCount(fromIsoDate(origStartIso), fromIsoDate(origEndIso));
      moved = false;
      bar.classList.add("ical-span-event--active");
      bar.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    handle?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      e.preventDefault();
      mode = "resize";
      el = bar;
      origStartIso = bar.dataset.startIso;
      origEndIso = bar.dataset.endIso;
      moved = false;
      bar.classList.add("ical-span-event--active");
      handle.setPointerCapture(e.pointerId);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });

  root.querySelectorAll(".ical-week-col[data-drop-day]").forEach((col) => {
    col.addEventListener("dblclick", (e) => {
      if (e.target.closest(".ical-span-event")) return;
      window.__enverOpenInstallSchedule?.({ isoDay: col.dataset.dropDay });
    });
  });
}
