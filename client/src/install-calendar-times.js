import { formatUaDate, parseUaDate } from "./install-calendar-dates.js";

export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 20 * 60;
export const SNAP_MIN = 15;
export const PX_PER_MIN = 1.35;
export const DEFAULT_DURATION_MIN = 180;
export const GRID_HEIGHT_PX = Math.round((DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN);

export function parseTime(str) {
  if (!str?.trim()) return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToTime(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function snapMinutes(min, step = SNAP_MIN) {
  return Math.round(min / step) * step;
}

export function clampMinutes(min) {
  return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, min));
}

export function getInstallSlot(position) {
  let start = parseTime(position.installTimeStart);
  let end = parseTime(position.installTimeEnd);
  if (start == null) start = 9 * 60;
  if (end == null || end <= start) end = Math.min(start + DEFAULT_DURATION_MIN, DAY_END_MIN);
  start = clampMinutes(start);
  end = clampMinutes(Math.max(end, start + SNAP_MIN));
  return { startMin: start, endMin: end };
}

export function formatTimeRange(startMin, endMin) {
  return `${minutesToTime(startMin)} – ${minutesToTime(endMin)}`;
}

export function eventFromPosition(position) {
  const date = parseUaDate(position.installDate);
  if (!date) return null;
  const { startMin, endMin } = getInstallSlot(position);
  return {
    position,
    date,
    startMin,
    endMin,
    allDay: !position.installTimeStart && !position.installTimeEnd
  };
}

export function topPxForMinutes(min) {
  return Math.round((min - DAY_START_MIN) * PX_PER_MIN);
}

export function heightPxForRange(startMin, endMin) {
  return Math.max(SNAP_MIN * PX_PER_MIN, Math.round((endMin - startMin) * PX_PER_MIN));
}

export function minutesFromPointerY(container, clientY) {
  const rect = container.getBoundingClientRect();
  const y = clientY - rect.top + container.scrollTop;
  const raw = y / PX_PER_MIN + DAY_START_MIN;
  return snapMinutes(clampMinutes(raw));
}

export function timeLabels() {
  const labels = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) {
    labels.push({ min: m, label: minutesToTime(m) });
  }
  return labels;
}

export function slotPresetOptions() {
  return [
    { label: "2 год", start: 9 * 60, end: 11 * 60 },
    { label: "3 год", start: 9 * 60, end: 12 * 60 },
    { label: "4 год", start: 9 * 60, end: 13 * 60 },
    { label: "Півдня", start: 12 * 60, end: 16 * 60 },
    { label: "Повний день", start: 8 * 60, end: 18 * 60 }
  ];
}

export function todayUaDate() {
  return formatUaDate(new Date());
}
