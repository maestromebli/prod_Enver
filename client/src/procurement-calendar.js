import { api } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import {
  addDays,
  formatMonthYear,
  formatShortDay,
  formatShortWeekday,
  fromIsoDate,
  isToday,
  monthGridDays,
  startOfMonth,
  toIsoDate
} from "./install-calendar-dates.js";
import {
  calendarEventFromItem,
  categoryColor,
  mtoCategoryLabel
} from "@enver/shared/production/procurement.js";
import { procurementStatusLabel } from "@enver/shared/production/constructive-package.js";

function ensureCalendarState() {
  const proc = state.procurement;
  if (!proc.calendar) {
    proc.calendar = {
      anchor: toIsoDate(new Date()),
      events: [],
      loading: false,
      categoryFilter: ""
    };
  }
  return proc.calendar;
}

export async function loadProcurementCalendar({ from, to } = {}) {
  const cal = ensureCalendarState();
  cal.loading = true;
  try {
    cal.events = await api.getProcurementCalendar({ from, to });
    return cal.events;
  } finally {
    cal.loading = false;
  }
}

function anchorDate() {
  const cal = ensureCalendarState();
  return fromIsoDate(cal.anchor || toIsoDate(new Date()));
}

function filteredEvents() {
  const cal = ensureCalendarState();
  const filter = cal.categoryFilter;
  return (cal.events || []).filter((ev) => !filter || ev.category === filter);
}

function eventsForDay(day) {
  const iso = toIsoDate(day);
  return filteredEvents().filter((ev) => {
    const d = ev.expectedDeliveryDate;
    return d === iso;
  });
}

function renderEventChip(ev) {
  const color = categoryColor(ev.category);
  const label = ev.name || mtoCategoryLabel(ev.category);
  const title = [ev.orderNumber, ev.positionItem, label].filter(Boolean).join(" · ");
  const overdue = ev.expectedDeliveryDate && ev.expectedDeliveryDate < toIsoDate(new Date());
  return `<button type="button" class="proc-cal-event ${overdue ? "proc-cal-event--overdue" : ""}"
    data-proc-cal-item="${ev.id}" title="${escapeHtml(title)}"
    style="--proc-cal-color:${escapeHtml(color)}">
    <span class="proc-cal-event-label">${escapeHtml(label)}</span>
    <span class="proc-cal-event-meta">${escapeHtml(ev.orderNumber || "")}</span>
  </button>`;
}

export function renderProcurementCalendar() {
  const cal = ensureCalendarState();
  if (cal.loading && !cal.events.length) {
    return `<div class="proc-cal proc-cal--loading enver-meta">Завантаження календаря…</div>`;
  }

  const anchor = anchorDate();
  const cells = monthGridDays(anchor);
  const monthStart = startOfMonth(anchor);

  const categories = [...new Set((cal.events || []).map((e) => e.category).filter(Boolean))];
  const catFilters = categories
    .map(
      (c) =>
        `<button type="button" class="enver-segmented-btn ${cal.categoryFilter === c ? "active" : ""}" data-proc-cal-cat="${escapeHtml(c)}">${escapeHtml(mtoCategoryLabel(c))}</button>`
    )
    .join("");

  const grid = cells
    .map((day) => {
      const inMonth = day.getMonth() === monthStart.getMonth();
      const dayEvents = eventsForDay(day);
      const classes = [
        "proc-cal-day",
        !inMonth ? "proc-cal-day--muted" : "",
        isToday(day) ? "proc-cal-day--today" : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `<div class="${classes}" data-proc-cal-day="${toIsoDate(day)}">
        <span class="proc-cal-day-num">${formatShortDay(day)}</span>
        <div class="proc-cal-day-events">${dayEvents.map(renderEventChip).join("")}</div>
      </div>`;
    })
    .join("");

  const upcoming = filteredEvents()
    .filter((ev) => ev.expectedDeliveryDate >= toIsoDate(new Date()))
    .slice(0, 8);

  const upcomingHtml = upcoming.length
    ? upcoming
        .map((ev) => {
          const pos = state.positions.find((p) => p.id === ev.positionId);
          const event = calendarEventFromItem(ev, pos || {});
          return `<li class="proc-cal-upcoming-item">
            <button type="button" data-proc-cal-item="${ev.id}">
              <strong>${escapeHtml(ev.expectedDeliveryDate)}</strong>
              ${escapeHtml([ev.orderNumber, ev.name].filter(Boolean).join(" · "))}
              ${event?.overdue ? '<span class="proc-badge-overdue">прострочено</span>' : ""}
            </button>
          </li>`;
        })
        .join("")
    : `<li class="enver-meta">Немає запланованих поставок</li>`;

  return `
    <div class="proc-cal card">
      <div class="proc-cal-toolbar">
        <div class="proc-cal-nav">
          <button type="button" class="btn btn-sm" data-proc-cal-nav="prev" aria-label="Попередній місяць">‹</button>
          <button type="button" class="btn btn-sm" data-proc-cal-nav="today">Сьогодні</button>
          <button type="button" class="btn btn-sm" data-proc-cal-nav="next" aria-label="Наступний місяць">›</button>
          <strong class="proc-cal-title">${escapeHtml(formatMonthYear(anchor))}</strong>
        </div>
        ${categories.length ? `<div class="enver-segmented proc-cal-cats">${catFilters}<button type="button" class="enver-segmented-btn ${!cal.categoryFilter ? "active" : ""}" data-proc-cal-cat="">Усі</button></div>` : ""}
      </div>
      <div class="proc-cal-weekdays">${cells
        .slice(0, 7)
        .map((d) => `<span>${formatShortWeekday(d)}</span>`)
        .join("")}</div>
      <div class="proc-cal-grid">${grid}</div>
      <aside class="proc-cal-sidebar">
        <h3 class="proc-cal-sidebar-title">Найближчі поставки</h3>
        <ul class="proc-cal-upcoming">${upcomingHtml}</ul>
      </aside>
    </div>
    <div id="procCalDetailMount" class="proc-cal-detail card" hidden></div>`;
}

function renderItemDetail(ev) {
  return `
    <h3>${escapeHtml(ev.name || mtoCategoryLabel(ev.category))}</h3>
    <p class="enver-meta">${escapeHtml([ev.orderNumber, ev.positionItem, ev.object].filter(Boolean).join(" · "))}</p>
    <dl class="proc-detail-dl">
      <dt>Категорія</dt><dd>${escapeHtml(mtoCategoryLabel(ev.category))}</dd>
      <dt>Дата поставки</dt><dd>${escapeHtml(ev.expectedDeliveryDate || "—")}</dd>
      <dt>Потрібно в цех</dt><dd>${escapeHtml(ev.requiredByDate || "—")}</dd>
      <dt>Постачальник</dt><dd>${escapeHtml(ev.supplier || "—")}</dd>
      <dt>Кількість</dt><dd>${escapeHtml(ev.qty || "—")} ${escapeHtml(ev.unit || "")}</dd>
      <dt>Статус</dt><dd>${escapeHtml(procurementStatusLabel(ev.status))}</dd>
    </dl>
    <div class="proc-detail-actions">
      <button type="button" class="btn btn-sm" data-proc-open-position="${ev.positionId}">Відкрити позицію</button>
      <button type="button" class="btn btn-sm" data-proc-cal-close>Закрити</button>
    </div>`;
}

export function bindProcurementCalendar(root, { onRefresh, onOpenPosition } = {}) {
  if (!root) return;

  const navigate = async (action) => {
    const cal = ensureCalendarState();
    let anchor = anchorDate();
    if (action === "today") anchor = new Date();
    else if (action === "prev") anchor = addDays(startOfMonth(anchor), -1);
    else if (action === "next") anchor = addDays(startOfMonth(anchor), 32);
    cal.anchor = toIsoDate(startOfMonth(anchor));
    const from = toIsoDate(startOfMonth(fromIsoDate(cal.anchor)));
    const end = addDays(startOfMonth(fromIsoDate(cal.anchor)), 41);
    await loadProcurementCalendar({ from, to: toIsoDate(end) });
    onRefresh?.();
  };

  root.querySelectorAll("[data-proc-cal-nav]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.procCalNav));
  });

  root.querySelectorAll("[data-proc-cal-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ensureCalendarState().categoryFilter = btn.dataset.procCalCat || "";
      onRefresh?.();
    });
  });

  const showDetail = (itemId) => {
    const ev = (state.procurement?.calendar?.events || []).find((e) => e.id === itemId);
    const mount =
      root.querySelector("#procCalDetailMount") || document.getElementById("procCalDetailMount");
    if (!mount || !ev) return;
    mount.hidden = false;
    mount.innerHTML = renderItemDetail(ev);
    mount.querySelector("[data-proc-cal-close]")?.addEventListener("click", () => {
      mount.hidden = true;
    });
    mount.querySelector("[data-proc-open-position]")?.addEventListener("click", () => {
      onOpenPosition?.(ev.positionId);
    });
  };

  root.querySelectorAll("[data-proc-cal-item]").forEach((btn) => {
    btn.addEventListener("click", () => showDetail(Number(btn.dataset.procCalItem)));
  });
}
