import { formatInstallPeriod } from "./install-utils.js";
import { getWorkPositions } from "@enver/shared/production/order-position-model.js";
import { currentFilters, filteredPositions } from "./filters.js";
import { parseUaDate } from "./install-calendar-dates.js";
import { ATTENTION_TAB, PRODUCTION_FLOOR_TAB, PROCUREMENT_TAB } from "./constants.js";
import { canViewProcurement } from "./auth.js";
import {
  countNewOrdersForCurrentRole,
  countNewProductionTasksForCurrentRole
} from "./role-notifications.js";
import { resolveObjectNameFromOrders } from "@enver/shared/production/object-display.js";
import { state } from "./state.js";
import { escapeHtml, overdue } from "./utils.js";
import { activeOrders, activePositions, archivedOrders, archivedPositions } from "./archive.js";
import {
  getDashboardOnboardingContent,
  isDashboardOnboardingDismissed,
  migrateLegacyOnboardingDismiss
} from "./dashboard-onboarding.js";
import { renderMyDaySection } from "./dashboard-role-day.js";

migrateLegacyOnboardingDismiss();

const ICONS = {
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  factory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 20V8l5 3V8l5 3V4l10 6v10H2z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 17h4V5H2v12h3M10 17H2M10 17v-3h4v3M14 17h2l3-3V8h-5v9M18 17h2v-3h-2"/></svg>`,
  chevron: `<svg class="dash-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`,
  pulse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`
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

function listRow({
  id,
  orderId,
  title,
  subtitle,
  meta,
  metaClass = "",
  metaIsHtml = false,
  badge
}) {
  const attrs = id
    ? ` data-edit-position="${id}"`
    : orderId
      ? ` data-dash-open-order="${orderId}"`
      : "";
  const navLabel = id
    ? `Відкрити позицію: ${title}`
    : orderId
      ? `Відкрити замовлення: ${title}`
      : title;
  return `
    <button type="button" class="dash-list-row"${attrs} aria-label="${escapeHtml(navLabel)}">
      <span class="dash-list-body">
        <span class="dash-list-title-row">
          ${badge ? `<span class="dash-row-badge dash-row-badge--${badge}"></span>` : ""}
          <span class="dash-list-title">${escapeHtml(title)}</span>
        </span>
        ${subtitle ? `<span class="dash-list-sub">${escapeHtml(subtitle)}</span>` : ""}
      </span>
      ${
        meta
          ? `<span class="dash-list-meta ${metaClass}">${metaIsHtml ? meta : escapeHtml(meta)}</span>`
          : ""
      }
      ${ICONS.chevron}
    </button>`;
}

function listWidget({ title, nav, rows, empty, className = "" }) {
  const body = rows.length ? rows.join("") : `<p class="dash-empty">${escapeHtml(empty)}</p>`;
  return `
    <section class="dash-panel ${className}" role="region" aria-label="${escapeHtml(title)}">
      <header class="dash-panel-head">
        <h3 class="dash-panel-title">${escapeHtml(title)}</h3>
        <button type="button" class="dash-panel-link" data-dash-nav="${escapeHtml(nav)}">Усі ${ICONS.chevron}</button>
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

function isOnboardingDismissed() {
  return isDashboardOnboardingDismissed();
}

function operationalStatus(problems, overdueCount, inWorkCount) {
  if (problems > 0) {
    return {
      tone: "critical",
      label: `${problems} ${problems === 1 ? "проблема" : "проблеми"}`,
      detail: "потребує негайної уваги"
    };
  }
  if (overdueCount > 0) {
    return {
      tone: "warn",
      label: `${overdueCount} простроч.`,
      detail: "перевірте терміни"
    };
  }
  if (inWorkCount > 0) {
    return {
      tone: "ok",
      label: "У роботі",
      detail: `${inWorkCount} поз. у виробництві`
    };
  }
  return {
    tone: "idle",
    label: "Спокійно",
    detail: "активних позицій немає"
  };
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

function renderDashboardStickyBar(focusPool) {
  const top = focusPool[0];
  if (!top) return "";

  const isProblem = top.problem?.trim() || top.positionStatus === "Проблема";
  const label = isProblem
    ? top.problem?.trim() || "Проблема на позиції"
    : top.overdueDays > 0
      ? `Прострочено: ${top.orderNumber}`
      : `${top.orderNumber} · ${top.item || "—"}`;

  return `
    <div class="enver-sticky-bar ${isProblem ? "enver-sticky-bar--blocked" : ""}" role="region" aria-label="Пріоритет">
      <div class="enver-sticky-bar-text">
        <span class="enver-sticky-bar-kicker">${isProblem ? "Проблема" : "У фокусі"}</span>
        <strong>${escapeHtml(label)}</strong>
      </div>
      <div class="enver-sticky-bar-actions">
        <button type="button" class="enver-sticky-bar-cta" data-edit-position="${top.id}">Відкрити</button>
        <button type="button" class="enver-sticky-bar-secondary" data-dash-nav="${escapeHtml(ATTENTION_TAB)}">Увага</button>
      </div>
    </div>`;
}

export function renderDashboard() {
  const filters = currentFilters();
  const filteredData = filteredPositions();
  const allData = activePositions(state.positions, state.orders);
  const filtersActive = hasActiveFilters(filters);
  const viewData = filtersActive ? filteredData : allData;
  const k = state.kpis;
  const userName = state.currentUser?.name?.split(" ")[0] || "";

  const problems = allData.filter((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const overdueItems = allData.filter((p) => (p.overdueDays ?? 0) > 0);
  const ready = allData.filter((p) => p.positionStatus === "Готово до встановлення");
  const inWork = allData.filter((p) => p.positionStatus === "У виробництві");

  const activeOrdersCount = k?.activeOrders ?? activeOrders(state.orders).length;
  const archivedOrdersCount = archivedOrders(state.orders).length;
  const archivedPositionsCount = archivedPositions(state.positions, state.orders).length;
  const installsCount = k?.installs ?? ready.length;
  const newOrdersCount = countNewOrdersForCurrentRole();
  const newTasksCount = countNewProductionTasksForCurrentRole();
  const status = operationalStatus(problems.length, overdueItems.length, inWork.length);
  const hasAlerts = newOrdersCount > 0 || newTasksCount > 0;

  const viewProblems = viewData.filter((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const problemIds = new Set(viewProblems.map((p) => p.id));
  const focusPool = [
    ...viewProblems,
    ...viewData.filter((p) => (p.overdueDays ?? 0) > 0 && !problemIds.has(p.id))
  ].slice(0, 6);
  const focusRows = focusPool.map((p) => {
    const isProblem = p.problem?.trim() || p.positionStatus === "Проблема";
    return listRow({
      id: p.id,
      title: `${p.orderNumber} · ${p.item || p.object}`,
      subtitle: p.problem?.trim() || p.positionStatus,
      meta: p.overdueDays > 0 ? overdue(p.overdueDays) : `${p.progress ?? 0}%`,
      metaClass: p.overdueDays > 0 ? "dash-meta-warn" : "",
      metaIsHtml: p.overdueDays > 0,
      badge: isProblem ? "critical" : "warn"
    });
  });

  const activeRows = viewData
    .filter((p) => p.positionStatus === "У виробництві")
    .slice(0, 6)
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
          <span class="dash-list-sub">${escapeHtml(resolveObjectNameFromOrders(p, state.orders))}</span>
          ${miniProgress(pct)}
        </span>
        <span class="dash-list-meta">${pct}%</span>
        ${ICONS.chevron}
      </button>`;
    });

  const orderRows = state.orders.slice(0, 3).map((o) => {
    const posCount = getWorkPositions(o, allData).length;
    return listRow({
      orderId: o.id,
      title: o.orderNumber,
      subtitle: o.client || o.object || "—",
      meta: posCount ? `${posCount} поз.` : "—"
    });
  });

  const installSoon = pickInstallSoon(viewData, 3);
  const installRows = installSoon.map((p) =>
    listRow({
      id: p.id,
      title: p.item || p.object,
      subtitle: p.installDate ? formatInstallPeriod(p) : "Дата не призначена",
      meta: p.installResponsible || "—"
    })
  );

  const showOnboarding = !isOnboardingDismissed();
  const onboarding = getDashboardOnboardingContent();
  const stickyBar = renderDashboardStickyBar(focusPool);

  return `
    <div class="dash-board${stickyBar ? " enver-screen--sticky-mobile" : ""}">
      <header class="dash-hero">
        <div class="dash-hero-main">
          <div class="dash-hero-text">
            <p class="dash-hero-greet">${escapeHtml(greeting())}${userName ? `, ${escapeHtml(userName)}` : ""}</p>
            <h2 class="dash-hero-title">Огляд виробництва</h2>
            <p class="dash-hero-date">${escapeHtml(todayLabel())}</p>
          </div>
          <div class="dash-hero-status dash-hero-status--${status.tone}" role="status">
            <span class="dash-hero-status-dot" aria-hidden="true"></span>
            <span class="dash-hero-status-label">${escapeHtml(status.label)}</span>
            <span class="dash-hero-status-detail">${escapeHtml(status.detail)}</span>
          </div>
        </div>
        <div class="dash-hero-actions">
          <nav class="dash-quick-nav" aria-label="Швидкі переходи">
            <button type="button" class="dash-quick-btn" data-dash-nav="Замовлення">Замовлення</button>
            <button type="button" class="dash-quick-btn" data-dash-nav="${escapeHtml(ATTENTION_TAB)}">Увага</button>
            <button type="button" class="dash-quick-btn" data-dash-nav="Встановлення">Монтажі</button>
            <button type="button" class="dash-quick-btn" data-dash-nav="${escapeHtml(PRODUCTION_FLOOR_TAB)}">Етапи</button>
            ${canViewProcurement() ? `<button type="button" class="dash-quick-btn" data-dash-nav="${escapeHtml(PROCUREMENT_TAB)}">Закупівля</button>` : ""}
          </nav>
        </div>
        ${
          filtersActive
            ? `<p class="dash-hero-filter-note" role="status" aria-live="polite">
                Списки відфільтровано (${escapeHtml(dashboardFilterLabel(filters))}). KPI — по всіх позиціях.
               </p>`
            : ""
        }
      </header>

      ${renderMyDaySection()}

      ${
        hasAlerts
          ? `<section class="dash-alert" role="status" aria-live="polite">
              <span class="dash-alert-icon">${ICONS.pulse}</span>
              <div class="dash-alert-text">
                <strong>Нові для вашої ролі</strong>
                <span>
                  ${newOrdersCount > 0 ? `${newOrdersCount} замовл.` : ""}${newOrdersCount > 0 && newTasksCount > 0 ? " · " : ""}${newTasksCount > 0 ? `${newTasksCount} завдань` : ""}
                </span>
              </div>
              <div class="dash-alert-actions">
                ${newOrdersCount > 0 ? `<button type="button" class="btn btn-sm" data-dash-nav="Замовлення">Переглянути</button>` : ""}
                ${newTasksCount > 0 ? `<button type="button" class="btn btn-sm btn-primary" data-dash-nav="${escapeHtml(PRODUCTION_FLOOR_TAB)}">До завдань</button>` : ""}
              </div>
            </section>`
          : ""
      }

      ${
        showOnboarding
          ? `<section class="dash-onboarding dash-onboarding--${escapeHtml(onboarding.persona)}" role="region" aria-label="Швидкий старт">
              <div class="dash-onboarding-body">
                <p class="dash-onboarding-kicker">${escapeHtml(onboarding.title)}</p>
                <p class="dash-onboarding-text">${escapeHtml(onboarding.lead)}</p>
                <ol class="dash-onboarding-steps">
                  ${onboarding.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
                </ol>
              </div>
              <div class="dash-onboarding-actions">
                <button type="button" class="btn btn-primary btn-sm" data-dash-nav="${escapeHtml(onboarding.primaryNav)}">${escapeHtml(onboarding.primaryLabel)}</button>
                <button type="button" class="btn btn-sm" data-dash-tour-start="1">Міні-тур</button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  data-dash-dismiss-onboarding="1"
                  data-dash-onboarding-persona="${escapeHtml(onboarding.persona)}"
                  aria-label="Не показувати підказку швидкого старту"
                >
                  Закрити
                </button>
              </div>
            </section>`
          : ""
      }

      <section class="dash-metrics" aria-label="Ключові показники">
        ${statTile({
          tone: "red",
          icon: ICONS.alert,
          value: problems.length,
          label: "Проблеми",
          hint: "потребують уваги",
          nav: "Проблеми"
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
          nav: "У виробництві"
        })}
        ${statTile({
          tone: "green",
          icon: ICONS.check,
          value: ready.length,
          label: "До монтажу",
          hint: "готові",
          nav: "До монтажу"
        })}
      </section>

      <div class="dash-main">
        ${listWidget({
          title: "Потребує уваги",
          nav: "У фокусі",
          rows: focusRows,
          empty: "Немає проблем і прострочок — все під контролем",
          className: "dash-panel--primary"
        })}

        ${listWidget({
          title: "У виробництві",
          nav: "У виробництві",
          rows: activeRows,
          empty: "Зараз немає позицій у виробництві",
          className: "dash-panel--secondary"
        })}
      </div>

      <div class="dash-secondary">
        <section class="dash-panel dash-panel--compact" role="region" aria-label="Замовлення">
          <header class="dash-panel-head">
            <h3 class="dash-panel-title">${ICONS.box} Замовлення <span class="dash-panel-count">${activeOrdersCount}</span></h3>
          </header>
          <div class="dash-list">
            ${orderRows.length ? orderRows.join("") : `<p class="dash-empty">Немає замовлень</p>`}
          </div>
          <footer class="dash-panel-foot">
            <button type="button" class="dash-panel-link" data-dash-nav="Замовлення">Реєстр ${ICONS.chevron}</button>
            <button type="button" class="dash-panel-link" data-dash-nav="Архів">
              Архів (${archivedOrdersCount}/${archivedPositionsCount}) ${ICONS.chevron}
            </button>
          </footer>
        </section>

        <section class="dash-panel dash-panel--compact" role="region" aria-label="Найближчі монтажі">
          <header class="dash-panel-head">
            <h3 class="dash-panel-title">${ICONS.truck} Монтажі <span class="dash-panel-count">${installsCount}</span></h3>
            <button type="button" class="dash-panel-link" data-dash-nav="Встановлення">Календар ${ICONS.chevron}</button>
          </header>
          <div class="dash-list">
            ${
              installRows.length
                ? installRows.join("")
                : `<p class="dash-empty">Немає запланованих монтажів</p>`
            }
          </div>
        </section>
      </div>
      ${stickyBar}
    </div>`;
}
