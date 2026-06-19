export { parseUaDate } from "@enver/shared/dates/ua-date.js";

const UA_MONTHS = [
  "січень",
  "лютий",
  "березень",
  "квітень",
  "травень",
  "червень",
  "липень",
  "серпень",
  "вересень",
  "жовтень",
  "листопад",
  "грудень"
];

const UA_MONTHS_SHORT = [
  "січ",
  "лют",
  "бер",
  "кві",
  "тра",
  "чер",
  "лип",
  "сер",
  "вер",
  "жов",
  "лис",
  "гру"
];

const UA_WEEKDAYS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const UA_WEEKDAYS_FULL = [
  "неділя",
  "понеділок",
  "вівторок",
  "середа",
  "четвер",
  "п'ятниця",
  "субота"
];

export function formatUaDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return startOfDay(d);
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date) {
  return isSameDay(date, new Date());
}

export function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

export function startOfMonth(date) {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(date) {
  return startOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function daysInMonth(date) {
  return endOfMonth(date).getDate();
}

export function monthGridDays(anchor) {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(addDays(start, i));
  }
  return cells;
}

export function weekDays(anchor) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatMonthYear(date) {
  return `${UA_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDayHeader(date) {
  const wd = UA_WEEKDAYS_FULL[date.getDay()];
  return `${wd}, ${date.getDate()} ${UA_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatWeekRange(anchor) {
  const days = weekDays(anchor);
  const start = days[0];
  const end = days[6];
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${UA_MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${UA_MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${UA_MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

export function formatShortWeekday(date) {
  return UA_WEEKDAYS[date.getDay()];
}

export function formatShortDay(date) {
  return String(date.getDate());
}

export { UA_WEEKDAYS, UA_MONTHS_SHORT };
