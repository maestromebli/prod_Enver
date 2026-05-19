import { addDays, formatUaDate, parseUaDate, toIsoDate, fromIsoDate } from "./install-calendar-dates.js";

/** Скільки монтажів на день вважаємо 100% завантаження */
export const DEFAULT_DAILY_CAPACITY = 3;

function parseEndDate(position) {
  const endRaw = position.installEndDate?.trim() || "";
  if (endRaw && !/^\d{1,2}:\d{2}$/.test(endRaw)) {
    const parsed = parseUaDate(endRaw);
    if (parsed) return parsed;
  }
  return null;
}

export function getInstallDayRange(position) {
  const start = parseUaDate(position.installDate);
  if (!start) return null;
  let end = parseEndDate(position) || start;
  if (end < start) end = new Date(start);
  return { start, end };
}

export function eventOverlapsMonth(ev, anchor) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  monthEnd.setHours(0, 0, 0, 0);
  return ev.startDate <= monthEnd && ev.endDate >= monthStart;
}

export function eventOverlapsWeek(ev, weekDays) {
  if (!weekDays.length) return false;
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];
  return ev.startDate <= weekEnd && ev.endDate >= weekStart;
}

export function countVisibleInView(scheduled, view, anchor, weekDays) {
  if (view === "agenda") return scheduled.length;
  if (view === "day") return scheduled.filter((e) => eventCoversDay(e, anchor)).length;
  if (view === "week") return scheduled.filter((e) => eventOverlapsWeek(e, weekDays)).length;
  return scheduled.filter((e) => eventOverlapsMonth(e, anchor)).length;
}

export function dayCount(start, end) {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86400000) + 1;
}

export function formatDayRange(start, end) {
  if (!start) return "—";
  const s = formatUaDate(start);
  if (!end || formatUaDate(end) === s) return s;
  return `${s} – ${formatUaDate(end)}`;
}

export function eventFromPosition(position) {
  const range = getInstallDayRange(position);
  if (!range) return null;
  const { start, end } = range;
  return {
    position,
    startDate: start,
    endDate: end,
    dayCount: dayCount(start, end),
    startIso: toIsoDate(start),
    endIso: toIsoDate(end)
  };
}

export function eachDayInRange(start, end, fn) {
  let d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (d <= last) {
    fn(new Date(d));
    d = addDays(d, 1);
  }
}

export function eventCoversDay(ev, day) {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  const t = d.getTime();
  return t >= ev.startDate.getTime() && t <= ev.endDate.getTime();
}

export function buildDayLoadMap(scheduled) {
  const map = new Map();
  scheduled.forEach((ev) => {
    eachDayInRange(ev.startDate, ev.endDate, (d) => {
      const iso = toIsoDate(d);
      map.set(iso, (map.get(iso) || 0) + 1);
    });
  });
  return map;
}

export function fillPercent(count, capacity = DEFAULT_DAILY_CAPACITY) {
  if (!capacity) return 0;
  return Math.min(150, Math.round((count / capacity) * 100));
}

export function fillLevel(count, capacity = DEFAULT_DAILY_CAPACITY) {
  const pct = fillPercent(count, capacity);
  if (pct === 0) return "empty";
  if (pct <= 50) return "low";
  if (pct <= 85) return "medium";
  if (pct <= 100) return "high";
  return "over";
}

export function fillLabel(count, capacity = DEFAULT_DAILY_CAPACITY) {
  const pct = fillPercent(count, capacity);
  return `${count}/${capacity} (${pct}%)`;
}

export function periodOccupancy(scheduled, days) {
  let totalSlots = 0;
  let usedSlots = 0;
  const capacity = DEFAULT_DAILY_CAPACITY;
  days.forEach((day) => {
    const iso = toIsoDate(day);
    const count = scheduled.filter((ev) => eventCoversDay(ev, day)).length;
    totalSlots += capacity;
    usedSlots += Math.min(count, capacity);
  });
  const pct = totalSlots ? Math.round((usedSlots / totalSlots) * 100) : 0;
  return { pct, usedSlots, totalSlots };
}

export function eventSpanInWeek(ev, weekDays) {
  if (!weekDays.length) return null;
  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];
  const visStart = ev.startDate > weekStart ? ev.startDate : weekStart;
  const visEnd = ev.endDate < weekEnd ? ev.endDate : weekEnd;
  if (visStart > visEnd) return null;
  const colStart = Math.floor((visStart.getTime() - weekStart.getTime()) / 86400000);
  const colLen = dayCount(visStart, visEnd);
  return { colStart, colLen, visStart, visEnd };
}

export function dayPresetOptions() {
  return [
    { label: "1 день", days: 1 },
    { label: "2 дні", days: 2 },
    { label: "3 дні", days: 3 },
    { label: "5 днів", days: 5 },
    { label: "Тиждень", days: 7 }
  ];
}

export function isoToInputDate(iso) {
  return iso || "";
}

export function inputDateToUa(iso) {
  if (!iso) return "";
  return formatUaDate(fromIsoDate(iso));
}
