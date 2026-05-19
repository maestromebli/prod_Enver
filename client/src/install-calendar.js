import { api } from "./api.js";
import { canEditPositions } from "./auth.js";
import { upsertPosition } from "./data-sync.js";
import {
  addDays,
  formatDayHeader,
  formatMonthYear,
  formatShortDay,
  formatShortWeekday,
  formatUaDate,
  formatWeekRange,
  fromIsoDate,
  isSameDay,
  isToday,
  monthGridDays,
  startOfMonth,
  toIsoDate,
  UA_WEEKDAYS,
  weekDays
} from "./install-calendar-dates.js";
import {
  buildDayLoadMap,
  countVisibleInView,
  DEFAULT_DAILY_CAPACITY,
  eventCoversDay,
  eventFromPosition,
  fillLabel,
  fillLevel,
  fillPercent,
  formatDayRange,
  periodOccupancy
} from "./install-calendar-days.js";
import { isInstallRelevant, READY_STATUS } from "./install-utils.js";
import { openInstallScheduleModal } from "./install-schedule-modal.js";
import { state } from "./state.js";
import { badge, escapeHtml } from "./utils.js";
import { toastError } from "./toast.js";

export { isInstallRelevant } from "./install-utils.js";

const INSTALLER_COLORS = [
  "#1a73e8",
  "#188038",
  "#e37400",
  "#9334e6",
  "#d93025",
  "#007b83",
  "#5f6368"
];

const VIEW_LABELS = { month: "Місяць", week: "Тиждень", day: "День", agenda: "Хронологія" };
const DISPLAY_LABELS = { calendar: "Календар", list: "Список" };

function getAnchor() {
  if (state.installCalendar.anchor) return fromIsoDate(state.installCalendar.anchor);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function setAnchor(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  state.installCalendar.anchor = toIsoDate(d);
}

function installerColor(name) {
  if (!name) return "#5f6368";
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return INSTALLER_COLORS[Math.abs(hash) % INSTALLER_COLORS.length];
}

function calendarPositions() {
  const { search, responsible } = getCalendarToolbarFilters();
  const installer = state.installCalendar.installerFilter;
  const parentItems = new Map(
    state.positions.filter((p) => !p.parentId).map((p) => [p.id, p.item])
  );

  return state.positions.filter((p) => {
    if (!isInstallRelevant(p)) return false;
    if (installer && p.installResponsible !== installer) return false;

    const parentItem = p.parentId ? parentItems.get(p.parentId) || "" : "";
    const text = [
      p.id,
      p.orderNumber,
      p.object,
      p.item,
      parentItem,
      p.installResponsible,
      p.installDate,
      p.installEndDate
    ]
      .join(" ")
      .toLowerCase();
    if (search && !text.includes(search)) return false;

    if (responsible) {
      const people = [p.manager, p.constructor, p.assemblyResponsible, p.installResponsible];
      if (!people.includes(responsible)) return false;
    }
    return true;
  });
}

function getCalendarToolbarFilters() {
  const searchEl = document.querySelector("#searchInput");
  const responsibleEl = document.querySelector("#responsibleFilter");
  return {
    search: (searchEl?.value ?? "").toLowerCase().trim(),
    responsible: responsibleEl?.value ?? ""
  };
}

/** Якщо в поточному періоді нічого не видно — перейти до першого запланованого монтажу */
export function ensureInstallCalendarAnchor(scheduled, view = state.installCalendar.view) {
  if (!scheduled.length) return false;
  const anchor = getAnchor();
  const days = view === "week" ? weekDays(anchor) : [];
  if (countVisibleInView(scheduled, view, anchor, days) > 0) return false;
  const target = scheduled[0].startDate;
  const next = toIsoDate(target);
  if (state.installCalendar.anchor === next) return false;
  state.installCalendar.anchor = next;
  return true;
}

function matchInstallerFilter(position) {
  const filter = state.installCalendar.installerFilter;
  return !filter || position.installResponsible === filter;
}

function buildEvents() {
  const items = calendarPositions().filter(matchInstallerFilter);
  const scheduled = [];
  const unscheduled = [];
  items.forEach((p) => {
    const ev = eventFromPosition(p);
    if (ev) scheduled.push(ev);
    else if (p.positionStatus === READY_STATUS || p.positionStatus === "На встановленні") {
      unscheduled.push(p);
    }
  });
  scheduled.sort((a, b) => a.startDate - b.startDate || a.position.id - b.position.id);
  unscheduled.sort((a, b) => (a.orderNumber || "").localeCompare(b.orderNumber || "", "uk"));
  return { scheduled, unscheduled };
}

function eventTitle(p) {
  const parts = [p.orderNumber, p.item].filter(Boolean);
  return parts.join(" · ") || `Позиція #${p.id}`;
}

function dayFillHtml(iso, loadMap) {
  const count = loadMap.get(iso) || 0;
  const level = fillLevel(count);
  const pct = fillPercent(count);
  return `
    <div class="ical-day-fill ical-day-fill--${level}" title="${fillLabel(count)}">
      <div class="ical-day-fill-track"><div class="ical-day-fill-bar" style="width:${pct}%"></div></div>
      <span class="ical-day-fill-count">${count > 0 ? count : ""}</span>
    </div>`;
}

function compactEventHtml(ev) {
  const p = ev.position;
  const range = formatDayRange(ev.startDate, ev.endDate);
  return `<button type="button" class="ical-event ical-event--compact" data-install-event="${p.id}" style="--event-color:${installerColor(p.installResponsible)}" title="${escapeHtml(range)}">
    <span class="ical-event-title">${escapeHtml(range)} · ${escapeHtml(eventTitle(p))}</span>
  </button>`;
}

function unscheduledItemHtml(p) {
  return `<button type="button" class="ical-queue-item" draggable="${canEditPositions()}" data-install-event="${p.id}">
    <span class="ical-queue-title">${escapeHtml(eventTitle(p))}</span>
    <span class="ical-queue-sub">${escapeHtml(p.object || "—")}</span>
    ${p.installResponsible ? `<span class="ical-queue-installer">${escapeHtml(p.installResponsible)}</span>` : ""}
  </button>`;
}

function outOfRangeHint(scheduled, view, anchor) {
  const nearest = scheduled[0];
  const label = formatDayRange(nearest.startDate, nearest.endDate);
  return `<div class="ical-range-hint">
    <p>У цьому періоді (${escapeHtml(headerTitle(view, anchor))}) монтажів не видно. Заплановано <strong>${scheduled.length}</strong> — найближчі: <strong>${escapeHtml(label)}</strong>.</p>
    <button type="button" class="btn btn-sm btn-primary" data-ical-jump-first">Перейти до монтажів</button>
  </div>`;
}

function weekViewHtml(anchor, scheduled, loadMap) {
  const days = weekDays(anchor);
  const cols = days
    .map((day) => {
      const iso = toIsoDate(day);
      const dayEvents = scheduled.filter((e) => eventCoversDay(e, day));
      const headCls = [
        "ical-week-col-head",
        isToday(day) ? "ical-week-col-head--today" : "",
        isSameDay(day, anchor) ? "ical-week-col-head--focus" : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `<div class="ical-week-col" data-drop-day="${iso}">
        <div class="${headCls}">
          <span class="ical-week-col-wd">${formatShortWeekday(day)}</span>
          <span class="ical-week-col-num">${formatShortDay(day)}</span>
          ${dayFillHtml(iso, loadMap)}
        </div>
        <div class="ical-week-col-events">
          ${dayEvents.map((e) => compactEventHtml(e)).join("") || '<span class="ical-empty-day">—</span>'}
        </div>
      </div>`;
    })
    .join("");

  return `<div class="ical-week-board"><div class="ical-week-grid">${cols}</div></div>`;
}

function dayViewHtml(anchor, scheduled, loadMap) {
  const iso = toIsoDate(anchor);
  const dayEvents = scheduled.filter((e) => eventCoversDay(e, anchor));
  return `<div class="ical-day-panel">
    ${dayFillHtml(iso, loadMap)}
    <div class="ical-day-list">${dayEvents.map((e) => compactEventHtml(e)).join("") || '<p class="ical-empty">Немає монтажів на цей день</p>'}</div>
  </div>`;
}

function dayCellHtml(day, anchor, scheduled, loadMap, compact) {
  const iso = toIsoDate(day);
  const dayEvents = scheduled.filter((e) => eventCoversDay(e, day));
  const more = dayEvents.length > (compact ? 2 : 4) ? dayEvents.length - (compact ? 2 : 4) : 0;
  const visible = dayEvents.slice(0, compact ? 2 : 4);
  const level = fillLevel(loadMap.get(iso) || 0);
  const cls = [
    "ical-day",
    `ical-day--fill-${level}`,
    !compact && day.getMonth() !== anchor.getMonth() ? "ical-day--outside" : "",
    isToday(day) ? "ical-day--today" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}" data-drop-day="${iso}">
    <div class="ical-day-head"><span class="ical-day-num">${formatShortDay(day)}</span></div>
    ${dayFillHtml(iso, loadMap)}
    <div class="ical-day-events">${visible.map((e) => compactEventHtml(e)).join("")}${more ? `<span class="ical-more">+${more}</span>` : ""}</div>
  </div>`;
}

function monthViewHtml(anchor, scheduled, loadMap) {
  const cells = monthGridDays(anchor);
  return `<div class="ical-month">
    <div class="ical-month-head">${UA_WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="ical-month-grid">${cells.map((d) => dayCellHtml(d, anchor, scheduled, loadMap, true)).join("")}</div>
  </div>`;
}

function agendaViewHtml(scheduled, unscheduled) {
  const groups = scheduled
    .map((e) => agendaRow(e))
    .join("");
  const queue =
    unscheduled.length > 0
      ? `<section class="ical-agenda-group ical-agenda-group--queue"><h3>Без дати (${unscheduled.length})</h3>${unscheduled.map((p) => agendaRow({ position: p, startDate: null })).join("")}</section>`
      : "";
  return groups || queue ? groups + queue : '<p class="ical-empty">Немає встановлень</p>';
}

function agendaRow(event) {
  const p = event.position;
  const range = event.startDate ? formatDayRange(event.startDate, event.endDate) : "—";
  return `<button type="button" class="ical-agenda-row" data-install-event="${p.id}" style="--event-color:${installerColor(p.installResponsible)}">
    <span class="ical-agenda-date">${escapeHtml(range)}</span>
    <span class="ical-agenda-main"><strong>${escapeHtml(eventTitle(p))}</strong><small>${escapeHtml(p.object || "")}</small></span>
    <span class="ical-agenda-installer">${escapeHtml(p.installResponsible || "—")}</span>
  </button>`;
}

function occupancySummaryHtml(scheduled, view, anchor) {
  let days;
  if (view === "week") days = weekDays(anchor);
  else if (view === "day") days = [anchor];
  else days = monthGridDays(anchor).filter((d) => d.getMonth() === anchor.getMonth());
  const { pct, usedSlots, totalSlots } = periodOccupancy(scheduled, days);
  const level = pct > 100 ? "over" : pct > 85 ? "high" : pct > 50 ? "medium" : pct > 0 ? "low" : "empty";
  return `<div class="ical-occupancy ical-occupancy--${level}" title="Завантажено ${usedSlots} з ${totalSlots} слотів (${DEFAULT_DAILY_CAPACITY} монтажі/день)">
    <span class="ical-occupancy-label">Заповнення</span>
    <div class="ical-occupancy-track"><div class="ical-occupancy-bar" style="width:${Math.min(pct, 100)}%"></div></div>
    <strong class="ical-occupancy-pct">${pct}%</strong>
  </div>`;
}

function statsBlock(scheduled, unscheduled, loadMap) {
  const todayIso = toIsoDate(new Date());
  const todayCount = loadMap.get(todayIso) || 0;
  return `<div class="ical-stats">
    <span class="ical-stat"><strong>${scheduled.length}</strong> монтажів</span>
    <span class="ical-stat"><strong>${todayCount}</strong> сьогодні</span>
    <span class="ical-stat ical-stat--warn"><strong>${unscheduled.length}</strong> без дати</span>
  </div>`;
}

function installerFilterOptions() {
  const installers = new Set(state.directories["Монтажники"] || []);
  calendarPositions().forEach((p) => {
    if (p.installResponsible) installers.add(p.installResponsible);
  });
  const current = state.installCalendar.installerFilter;
  return `<option value="">Усі монтажники</option>${Array.from(installers)
    .sort((a, b) => a.localeCompare(b, "uk"))
    .map((n) => `<option value="${escapeHtml(n)}" ${n === current ? "selected" : ""}>${escapeHtml(n)}</option>`)
    .join("")}`;
}

function fillLegendHtml() {
  return `<div class="ical-fill-legend">
    <span><i class="fill-swatch fill-swatch--empty"></i>вільно</span>
    <span><i class="fill-swatch fill-swatch--low"></i>до 50%</span>
    <span><i class="fill-swatch fill-swatch--medium"></i>до 85%</span>
    <span><i class="fill-swatch fill-swatch--high"></i>до 100%</span>
    <span><i class="fill-swatch fill-swatch--over"></i>перевантаження</span>
  </div>`;
}

function miniMonthHtml(anchor, loadMap) {
  const monthStart = startOfMonth(anchor);
  const cells = monthGridDays(anchor);
  const days = cells
    .map((day) => {
      const inMonth = day.getMonth() === monthStart.getMonth();
      const iso = toIsoDate(day);
      const level = fillLevel(loadMap.get(iso) || 0);
      const cls = [
        "ical-mini-day",
        `ical-mini-day--${level}`,
        !inMonth ? "ical-mini-day--muted" : "",
        isToday(day) ? "ical-mini-day--today" : "",
        isSameDay(day, anchor) ? "ical-mini-day--selected" : ""
      ]
        .filter(Boolean)
        .join(" ");
      const count = loadMap.get(iso) || 0;
      return `<button type="button" class="${cls}" data-mini-day="${iso}" title="${fillLabel(count)}">${day.getDate()}</button>`;
    })
    .join("");
  return `<div class="ical-mini-month"><div class="ical-mini-title">${formatMonthYear(monthStart)}</div>
    <div class="ical-mini-weekdays">${UA_WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="ical-mini-grid">${days}</div></div>`;
}

function sidebarHtml(anchor, scheduled, unscheduled, loadMap, view) {
  return `<aside class="ical-sidebar">
    <button type="button" class="btn btn-primary ical-create-btn" id="icalCreateBtn" ${canEditPositions() ? "" : "hidden"}>+ Запланувати монтаж</button>
    ${occupancySummaryHtml(scheduled, view, anchor)}
    ${miniMonthHtml(anchor, loadMap)}
    ${fillLegendHtml()}
    <div class="ical-queue">
      <h4>Без дати <span class="ical-queue-count">${unscheduled.length}</span></h4>
      <div class="ical-queue-list">${unscheduled.map(unscheduledItemHtml).join("") || '<p class="ical-empty">Усі готові позиції заплановані</p>'}</div>
    </div>
    <div class="ical-legend"><h4>Монтажники</h4>${legendInstallers(scheduled, unscheduled)}</div>
  </aside>`;
}

function legendInstallers(scheduled, unscheduled) {
  const names = new Set();
  [...scheduled.map((e) => e.position.installResponsible), ...unscheduled.map((p) => p.installResponsible)]
    .filter(Boolean)
    .forEach((n) => names.add(n));
  if (!names.size) return '<p class="ical-empty">—</p>';
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, "uk"))
    .map((n) => `<span class="ical-legend-item"><i style="background:${installerColor(n)}"></i>${escapeHtml(n)}</span>`)
    .join("");
}

function headerTitle(view, anchor) {
  if (view === "month") return formatMonthYear(anchor);
  if (view === "week") return formatWeekRange(anchor);
  if (view === "day") return formatDayHeader(anchor);
  return "Усі встановлення";
}

function mainGridHtml(view, anchor, scheduled, unscheduled, loadMap) {
  if (view === "month") return monthViewHtml(anchor, scheduled, loadMap);
  if (view === "week") return weekViewHtml(anchor, scheduled, loadMap);
  if (view === "day") return dayViewHtml(anchor, scheduled, loadMap);
  return `<div class="ical-agenda">${agendaViewHtml(scheduled, unscheduled)}</div>`;
}

function installModeBarHtml() {
  const mode = state.installCalendar.displayMode || "calendar";
  const buttons = Object.entries(DISPLAY_LABELS)
    .map(
      ([key, label]) =>
        `<button type="button" class="install-mode-btn ${mode === key ? "active" : ""}" data-install-mode="${key}">${label}</button>`
    )
    .join("");
  return `<div class="install-mode-bar card"><div class="install-mode-switch">${buttons}</div></div>`;
}

function installStatusLabel(p) {
  if (p.installDate?.trim()) return "Заплановано";
  if (p.positionStatus === READY_STATUS) return READY_STATUS;
  if (p.positionStatus === "На встановленні") return "На встановленні";
  return p.positionStatus || "—";
}

function renderInstallList() {
  const { scheduled, unscheduled } = buildEvents();
  const rows = [
    ...scheduled.map((ev) => ({ position: ev.position, range: formatDayRange(ev.startDate, ev.endDate) })),
    ...unscheduled.map((p) => ({ position: p, range: "—" }))
  ];

  const body = rows.length
    ? rows
        .map(({ position: p, range }) => {
          const status = installStatusLabel(p);
          const progressNote =
            p.progress < 100 ? "Не всі етапи закриті" : p.problem ? escapeHtml(p.problem) : "—";
          const scheduleBtn = canEditPositions()
            ? `<button type="button" class="btn btn-sm" data-install-schedule="${p.id}">${p.installDate ? "Дата" : "Запланувати"}</button>`
            : "";
          return `<tr class="install-list-row row-clickable" data-install-list-row="${p.id}">
            <td>${p.id}</td>
            <td>${escapeHtml(p.orderNumber || "—")}</td>
            <td>${escapeHtml(p.object || "—")}</td>
            <td class="left">${escapeHtml(p.item || "—")}</td>
            <td>${escapeHtml(p.readyDate || "—")}</td>
            <td><strong>${escapeHtml(range)}</strong></td>
            <td>${escapeHtml(p.installResponsible || "—")}</td>
            <td>${badge(status)}</td>
            <td class="left muted">${progressNote}</td>
            <td><div class="actions-cell">${scheduleBtn}<button type="button" class="btn btn-sm btn-ghost" data-edit-position="${p.id}">Картка</button></div></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="empty-cell">Немає позицій для встановлення</td></tr>`;

  return `<div class="install-list card" id="installList">
    <div class="install-list-toolbar">
      <h2 class="install-list-title">Встановлення</h2>
      <select class="ical-installer-filter" id="icalInstallerFilter">${installerFilterOptions()}</select>
      <div class="install-list-stats">
        <span><strong>${scheduled.length}</strong> з датою</span>
        <span class="ical-stat--warn"><strong>${unscheduled.length}</strong> без дати</span>
      </div>
    </div>
    <div class="table-wrap">
      <table class="install-list-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Замовлення</th>
            <th>Об'єкт</th>
            <th class="left">Виріб</th>
            <th>Готовність</th>
            <th>Період монтажу</th>
            <th>Монтажник</th>
            <th>Статус</th>
            <th class="left">Примітка</th>
            <th>Дії</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

export function renderInstallTab() {
  return `<div class="install-tab">${installModeBarHtml()}${state.installCalendar.displayMode === "list" ? renderInstallList() : renderInstallCalendar()}</div>`;
}

function renderInstallCalendar() {
  const view = state.installCalendar.view;
  let anchor = getAnchor();
  let { scheduled, unscheduled } = buildEvents();
  ensureInstallCalendarAnchor(scheduled, view);
  anchor = getAnchor();
  const loadMap = buildDayLoadMap(scheduled);
  const weekDaysList = view === "week" ? weekDays(anchor) : [];
  const visibleCount = countVisibleInView(scheduled, view, anchor, weekDaysList);
  const rangeHint =
    scheduled.length > 0 && visibleCount === 0 ? outOfRangeHint(scheduled, view, anchor) : "";
  const views = Object.entries(VIEW_LABELS)
    .map(
      ([key, label]) =>
        `<button type="button" class="ical-view-btn ${view === key ? "active" : ""}" data-ical-view="${key}">${label}</button>`
    )
    .join("");

  return `<div class="install-calendar card" id="installCalendar">
    <div class="ical-toolbar">
      <div class="ical-toolbar-left">
        <button type="button" class="btn btn-sm" data-ical-nav="today">Сьогодні</button>
        <div class="ical-nav">
          <button type="button" class="ical-nav-btn" data-ical-nav="prev">‹</button>
          <button type="button" class="ical-nav-btn" data-ical-nav="next">›</button>
        </div>
        <h2 class="ical-title">${escapeHtml(headerTitle(view, anchor))}</h2>
      </div>
      <div class="ical-toolbar-center">${views}</div>
      <div class="ical-toolbar-right">
        <select class="ical-installer-filter" id="icalInstallerFilter">${installerFilterOptions()}</select>
        ${statsBlock(scheduled, unscheduled, loadMap)}
      </div>
    </div>
    <div class="ical-body">
      ${sidebarHtml(anchor, scheduled, unscheduled, loadMap, view)}
      <div class="ical-main ical-main--${view}">${rangeHint}${mainGridHtml(view, anchor, scheduled, unscheduled, loadMap)}</div>
    </div>
    ${canEditPositions() ? '<p class="ical-hint">Перетягніть позицію з черги на день · клік по події — редагування · міні-календар зліва — швидкий перехід</p>' : ""}
  </div>`;
}

function navigate(delta) {
  const view = state.installCalendar.view;
  const anchor = getAnchor();
  if (view === "month" || view === "agenda") {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
  } else if (view === "week") {
    setAnchor(addDays(anchor, delta * 7));
  } else {
    setAnchor(addDays(anchor, delta));
  }
}

function bindInstallerFilter() {
  document.querySelector("#icalInstallerFilter")?.addEventListener("change", (e) => {
    state.installCalendar.installerFilter = e.target.value;
    window.__enverRender?.({ contentOnly: true });
  });
}

function bindInstallList() {
  const root = document.getElementById("installList");
  if (!root) return;

  window.__enverOpenInstallSchedule = (opts) => openInstallScheduleModal(opts);
  bindInstallerFilter();

  const openById = (id) => {
    const p = state.positions.find((x) => x.id === Number(id));
    if (p) openInstallScheduleModal({ position: p });
  };

  root.querySelectorAll("[data-install-list-row]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openById(row.dataset.installListRow);
    });
  });

  root.querySelectorAll("[data-install-schedule]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openById(btn.dataset.installSchedule);
    });
  });
}

export function bindInstallTab() {
  document.querySelectorAll("[data-install-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.installCalendar.displayMode = btn.dataset.installMode;
      window.__enverRender?.({ contentOnly: true });
    });
  });

  if (state.installCalendar.displayMode === "list") {
    bindInstallList();
  } else {
    bindInstallCalendar();
  }
}

export function bindInstallCalendar() {
  const root = document.getElementById("installCalendar");
  if (!root) return;

  window.__enverOpenInstallSchedule = (opts) => openInstallScheduleModal(opts);

  root.querySelectorAll("[data-ical-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.installCalendar.view = btn.dataset.icalView;
      window.__enverRender?.({ contentOnly: true });
    });
  });

  root.querySelectorAll("[data-ical-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.icalNav;
      if (action === "today") setAnchor(new Date());
      else if (action === "prev") navigate(-1);
      else if (action === "next") navigate(1);
      window.__enverRender?.({ contentOnly: true });
    });
  });

  root.querySelectorAll("[data-mini-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setAnchor(fromIsoDate(btn.dataset.miniDay));
      state.installCalendar.view = "day";
      window.__enverRender?.({ contentOnly: true });
    });
  });

  bindInstallerFilter();

  root.querySelector("#icalCreateBtn")?.addEventListener("click", () => {
    openInstallScheduleModal({ isoDay: state.installCalendar.anchor || toIsoDate(new Date()) });
  });

  const openById = (id) => {
    const p = state.positions.find((x) => x.id === Number(id));
    if (p) openInstallScheduleModal({ position: p });
  };

  root
    .querySelectorAll(
      "[data-install-event].ical-event, [data-install-event].ical-agenda-row, [data-install-event].ical-queue-item"
    )
    .forEach((el) => {
      el.addEventListener("click", () => openById(el.dataset.installEvent));
    });

  root.querySelector("[data-ical-jump-first]")?.addEventListener("click", () => {
    const { scheduled: evs } = buildEvents();
    if (!evs.length) return;
    state.installCalendar.anchor = toIsoDate(evs[0].startDate);
    window.__enverRender?.({ contentOnly: true });
  });

  if (!canEditPositions()) return;

  root.querySelectorAll(".ical-queue-item[draggable='true']").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", String(el.dataset.installEvent));
    });
  });

  root.querySelectorAll("[data-drop-day]").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      e.preventDefault();
      zone.classList.add("ical-day--dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("ical-day--dragover"));
    zone.addEventListener("drop", async (e) => {
      const id = Number(e.dataTransfer?.getData("text/plain"));
      if (!id) return;
      e.preventDefault();
      zone.classList.remove("ical-day--dragover");
      const iso = zone.dataset.dropDay;
      const ua = formatUaDate(fromIsoDate(iso));
      try {
        const updated = await api.patchPositionInstall(id, {
          installDate: ua,
          installEndDate: ua,
          installTimeStart: "",
          installTimeEnd: ""
        });
        upsertPosition(updated);
        window.__enverRender?.({ contentOnly: true });
      } catch (err) {
        toastError(err.message);
      }
    });
  });
}
