import { currentFilters, filteredPositions } from "./filters.js";
import { parseUaDate } from "./install-calendar-dates.js";
import { state } from "./state.js";
import { escapeHtml, overdue } from "./utils.js";

const ICONS = {
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  factory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 20V8l5 3V8l5 3V4l10 6v10H2z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 17h4V5H2v12h3M10 17H2M10 17v-3h4v3M14 17h2l3-3V8h-5v9M18 17h2v-3h-2"/></svg>`,
  chevron: `<svg class="dash-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Доброго ранку";
  if (h < 18) return "Доброго дня";
  return "Доброго вечора";
}

function todayLabel() {
  return new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date());
}

function statTile({ tone, icon, value, label, hint, nav }) {
  return `
    <button
      type="button"
      class="dash-tile dash-tile--stat dash-tile--${tone}"
      data-dash-nav="${escapeHtml(nav)}"
      aria-label="${escapeHtml(`${label}: ${value}. ${hint}`)}"
    >
      <span class="dash-tile-icon">${icon}</span>
      <span class="dash-tile-value">${value}</span>
      <span class="dash-tile-label">${escapeHtml(label)}</span>
      <span class="dash-tile-hint">${escapeHtml(hint)}</span>
    </button>`;
}

function listRow({ id, orderId, title, subtitle, meta, metaClass = "" }) {
  const attrs = id
    ? ` data-edit-position="${id}"`
    : orderId
      ? ` data-edit-order="${orderId}"`
      : "";
  const navLabel = id
    ? `Відкрити позицію: ${title}`
    : orderId
      ? `Відкрити замовлення: ${title}`
      : title;
  return `
    <button type="button" class="dash-list-row"${attrs} aria-label="${escapeHtml(navLabel)}">
      <span class="dash-list-body">
        <span class="dash-list-title">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="dash-list-sub">${escapeHtml(subtitle)}</span>` : ""}
      </span>
      ${meta ? `<span class="dash-list-meta ${metaClass}">${meta}</span>` : ""}
      ${ICONS.chevron}
    </button>`;
}

function listWidget({ title, nav, rows, empty, span = "md" }) {
  const body = rows.length
    ? rows.join("")
    : `<p class="dash-empty">${escapeHtml(empty)}</p>`;
  return `
    <section class="dash-tile dash-tile--list dash-tile--${span}" role="region" aria-label="${escapeHtml(title)}">
      <header class="dash-tile-head">
        <h3 class="dash-tile-title">${escapeHtml(title)}</h3>
        <button type="button" class="dash-tile-link" data-dash-nav="${escapeHtml(nav)}">Усі ${ICONS.chevron}</button>
      </header>
      <div class="dash-list">${body}</div>
    </section>`;
}

function miniProgress(pct) {
  const v = Math.min(100, Math.max(0, Number(pct) || 0));
  return `<div class="dash-mini-bar" role="presentation"><span style="width:${v}%"></span></div>`;
}

function hasActiveFilters(filters) {
  return Boolean(filters.search || filters.status || filters.responsible);
}

function dashboardFilterLabel(filters) {
  const labels = [];
  if (filters.search) labels.push(`пошук: "${filters.search}"`);
  if (filters.status) labels.push(`статус: ${filters.status}`);
  if (filters.responsible) labels.push(`відповідальний: ${filters.responsible}`);
  return labels.join(" · ");
}

function installDateRank(position) {
  const parsed = parseUaDate(position.installDate || "");
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  return parsed.getTime();
}

export function pickInstallSoon(positions, limit = 4) {
  return positions
    .filter((p) => p.installDate || p.positionStatus === "Готово до встановлення")
    .sort((a, b) => {
      const rankDiff = installDateRank(a) - installDateRank(b);
      if (rankDiff !== 0) return rankDiff;
      const byOrder = String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""), "uk");
      if (byOrder !== 0) return byOrder;
      return Number(a.id || 0) - Number(b.id || 0);
    })
    .slice(0, limit);
}

export function renderDashboard() {
  const filters = currentFilters();
  const filteredData = filteredPositions();
  const allData = state.positions;
  const filtersActive = hasActiveFilters(filters);
  const viewData = filtersActive ? filteredData : allData;
  const k = state.kpis;
  const userName = state.currentUser?.name?.split(" ")[0] || "";

  const problems = allData.filter((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const overdueItems = allData.filter((p) => (p.overdueDays ?? 0) > 0);
  const ready = allData.filter((p) => p.positionStatus === "Готово до встановлення");
  const inWork = allData.filter((p) => p.positionStatus === "У виробництві");

  const activeOrders = k?.activeOrders ?? state.orders.length;
  const installsCount = k?.installs ?? ready.length;

  const viewProblems = viewData.filter((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const problemIds = new Set(viewProblems.map((p) => p.id));
  const focusPool = [
    ...viewProblems,
    ...viewData.filter((p) => (p.overdueDays ?? 0) > 0 && !problemIds.has(p.id))
  ].slice(0, 5);
  const focusRows = focusPool.map((p) =>
    listRow({
      id: p.id,
      title: `${p.orderNumber} · ${p.item || p.object}`,
      subtitle: p.problem?.trim() || p.positionStatus,
      meta: p.overdueDays > 0 ? overdue(p.overdueDays) : `${p.progress ?? 0}%`,
      metaClass: p.overdueDays > 0 ? "dash-meta-warn" : ""
    })
  );

  const overdueRows = viewData
    .filter((p) => (p.overdueDays ?? 0) > 0)
    .slice(0, 4)
    .map((p) =>
      listRow({
        id: p.id,
        title: p.item || p.object,
        subtitle: p.orderNumber,
        meta: overdue(p.overdueDays),
        metaClass: "dash-meta-warn"
      })
    );

  const readyRows = viewData
    .filter((p) => p.positionStatus === "Готово до встановлення")
    .slice(0, 4)
    .map((p) =>
      listRow({
        id: p.id,
        title: p.item || p.object,
        subtitle: p.installDate ? `Монтаж ${p.installDate}` : p.object,
        meta: p.installResponsible || "—"
      })
    );

  const activeRows = viewData
    .filter((p) => p.positionStatus === "У виробництві")
    .slice(0, 5)
    .map((p) => {
      const pct = p.progress ?? 0;
      return `
      <button
        type="button"
        class="dash-list-row dash-list-row--progress"
        data-edit-position="${p.id}"
        aria-label="${escapeHtml(`Відкрити позицію ${p.orderNumber} · ${p.item || "—"}`)}"
      >
        <span class="dash-list-body">
          <span class="dash-list-title">${escapeHtml(p.orderNumber)} · ${escapeHtml(p.item || "—")}</span>
          <span class="dash-list-sub">${escapeHtml(p.object)}</span>
          ${miniProgress(pct)}
        </span>
        <span class="dash-list-meta">${pct}%</span>
        ${ICONS.chevron}
      </button>`;
    });

  const positionsByOrderId = allData.reduce((map, p) => {
    map.set(p.orderId, (map.get(p.orderId) || 0) + 1);
    return map;
  }, new Map());
  const orderRows = state.orders.slice(0, 4).map((o) => {
    const posCount = positionsByOrderId.get(o.id) || 0;
    return listRow({
      orderId: o.id,
      title: o.orderNumber,
      subtitle: o.client || o.object || "—",
      meta: posCount ? `${posCount} поз.` : "—"
    });
  });

  const installSoon = pickInstallSoon(viewData, 4);

  const installRows = installSoon.map((p) =>
    listRow({
      id: p.id,
      title: p.item || p.object,
      subtitle: p.installDate || "Дата не призначена",
      meta: p.installResponsible?.slice(0, 12) || "—"
    })
  );

  return `
    <div class="dash-board">
      <header class="dash-hero">
        <div class="dash-hero-text">
          <p class="dash-hero-greet">${escapeHtml(greeting())}${userName ? `, ${escapeHtml(userName)}` : ""}</p>
          <h2 class="dash-hero-title">Штаб виробництва</h2>
          <p class="dash-hero-date">${escapeHtml(todayLabel())}</p>
          ${
            filtersActive
              ? `<p class="dash-hero-filter-note" role="status" aria-live="polite">
                  Показано списки за фільтрами (${escapeHtml(dashboardFilterLabel(filters))}). KPI-картки рахуються по всіх позиціях.
                 </p>`
              : ""
          }
        </div>
        <div class="dash-hero-badge" aria-hidden="true">ENVER</div>
      </header>

      <div class="dash-bento" aria-label="Огляд показників дашборду">
        ${statTile({
          tone: "red",
          icon: ICONS.alert,
          value: problems.length,
          label: "Проблеми",
          hint: "потребують уваги",
          nav: "Позиції замовлення"
        })}
        ${statTile({
          tone: "orange",
          icon: ICONS.clock,
          value: overdueItems.length,
          label: "Прострочені",
          hint: "понад план",
          nav: "Прострочки"
        })}
        ${statTile({
          tone: "blue",
          icon: ICONS.factory,
          value: inWork.length,
          label: "У виробництві",
          hint: "активні позиції",
          nav: "Позиції замовлення"
        })}
        ${statTile({
          tone: "green",
          icon: ICONS.check,
          value: ready.length,
          label: "До монтажу",
          hint: "готові",
          nav: "Встановлення"
        })}

        ${listWidget({
          title: "У фокусі",
          nav: "Позиції замовлення",
          rows: focusRows,
          empty: "Немає проблем і прострочок — все під контролем",
          span: "wide"
        })}

        ${listWidget({
          title: "Прострочені",
          nav: "Прострочки",
          rows: overdueRows,
          empty: "Прострочених позицій немає"
        })}

        ${listWidget({
          title: "Готові до монтажу",
          nav: "Встановлення",
          rows: readyRows,
          empty: "Немає позицій, готових до встановлення"
        })}

        <section class="dash-tile dash-tile--list dash-tile--wide" role="region" aria-label="У виробництві">
          <header class="dash-tile-head">
            <h3 class="dash-tile-title">У виробництві</h3>
            <button type="button" class="dash-tile-link" data-dash-nav="Позиції замовлення">Усі ${ICONS.chevron}</button>
          </header>
          <div class="dash-list">
            ${
              activeRows.length
                ? activeRows.join("")
                : `<p class="dash-empty">Зараз немає позицій у виробництві</p>`
            }
          </div>
        </section>

        <section class="dash-tile dash-tile--list dash-tile--compact" role="region" aria-label="Замовлення">
          <header class="dash-tile-head">
            <h3 class="dash-tile-title">${ICONS.box} Замовлення</h3>
            <span class="dash-tile-count">${activeOrders}</span>
          </header>
          <div class="dash-list">
            ${
              orderRows.length
                ? orderRows.join("")
                : `<p class="dash-empty">Немає замовлень</p>`
            }
          </div>
          <footer class="dash-tile-foot">
            <button type="button" class="dash-tile-link" data-dash-nav="Замовлення">Відкрити реєстр ${ICONS.chevron}</button>
          </footer>
        </section>

        <section class="dash-tile dash-tile--list dash-tile--compact" role="region" aria-label="Встановлення">
          <header class="dash-tile-head">
            <h3 class="dash-tile-title">${ICONS.truck} Встановлення</h3>
            <span class="dash-tile-count">${installsCount}</span>
          </header>
          <div class="dash-list">
            ${
              installRows.length
                ? installRows.join("")
                : `<p class="dash-empty">Немає запланованих монтажів</p>`
            }
          </div>
          <footer class="dash-tile-foot">
            <button type="button" class="dash-tile-link" data-dash-nav="Встановлення">Календар монтажів ${ICONS.chevron}</button>
          </footer>
        </section>
      </div>
    </div>`;
}
