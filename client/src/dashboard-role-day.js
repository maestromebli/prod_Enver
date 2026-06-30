import { dashboardPersona } from "./dashboard-onboarding.js";
import { activePositions } from "./archive.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { resolvePositionGodmode } from "./godmode-ui.js";
import { attentionFromState, countAttentionItems } from "./attention.js";
import {
  ATTENTION_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB,
  PRODUCTION_FLOOR_TAB
} from "./constants.js";
import {
  canEditOrders,
  canViewConstructorDesk,
  canViewProcurement,
  canViewProductionFloor
} from "./auth.js";
import { stageLabel } from "@enver/shared/production/stages.js";

function myPositions() {
  return activePositions(state.positions, state.orders);
}

function constructorPositions(limit = 6) {
  const user = state.currentUser;
  const uid = user?.id;
  const name = String(user?.name || "").trim();
  return myPositions()
    .filter((p) => {
      if (uid && p.constructorUserId === uid) return true;
      const assigned = String(p.constructorUserName || p.constructor || "").trim();
      return name && assigned === name;
    })
    .sort(
      (a, b) =>
        (resolvePositionGodmode(b).attentionScore || 0) -
        (resolvePositionGodmode(a).attentionScore || 0)
    )
    .slice(0, limit);
}

function managerFocusPositions(limit = 6) {
  return myPositions()
    .filter((p) => !p.managerDataComplete || p.problem?.trim() || (p.overdueDays ?? 0) > 0)
    .sort(
      (a, b) =>
        (resolvePositionGodmode(b).attentionScore || 0) -
        (resolvePositionGodmode(a).attentionScore || 0)
    )
    .slice(0, limit);
}

function productionAttentionPreview(limit = 5) {
  return attentionFromState(state)
    .filter((i) => i.kind === "blocker" || i.kind === "next" || i.code === "overdue")
    .slice(0, limit);
}

function rowButton({ id, title, subtitle, meta, nav }) {
  const attrs = id
    ? ` data-edit-position="${id}"`
    : nav
      ? ` data-dash-nav="${escapeHtml(nav)}"`
      : "";
  return `
    <button type="button" class="dash-my-day-row"${attrs}>
      <span class="dash-my-day-body">
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<span class="enver-meta">${escapeHtml(subtitle)}</span>` : ""}
      </span>
      ${meta ? `<span class="dash-my-day-meta">${escapeHtml(meta)}</span>` : ""}
    </button>`;
}

function sectionShell({ kicker, title, hint, nav, navLabel, rows, empty }) {
  const body = rows.length
    ? `<div class="dash-my-day-list">${rows.join("")}</div>`
    : `<p class="dash-my-day-empty">${escapeHtml(empty)}</p>`;
  return `
    <header class="dash-my-day-head">
      <div>
        <p class="dash-my-day-kicker">${escapeHtml(kicker)}</p>
        <h3 class="dash-my-day-title">${escapeHtml(title)}</h3>
        ${hint ? `<p class="dash-my-day-hint enver-meta">${escapeHtml(hint)}</p>` : ""}
      </div>
      ${nav ? `<button type="button" class="btn btn-sm dash-my-day-link" data-dash-nav="${escapeHtml(nav)}">${escapeHtml(navLabel)}</button>` : ""}
    </header>
    ${body}`;
}

function renderConstructorDay() {
  const items = constructorPositions();
  const rows = items.map((p) =>
    rowButton({
      id: p.id,
      title: `${p.orderNumber} · ${p.item || "—"}`,
      subtitle: p.constructivePackageStatus
        ? `Пакет: ${p.constructivePackageStatus}`
        : stageLabel(p.currentStage || "constructor"),
      meta: `${p.progress ?? 0}%`
    })
  );
  return sectionShell({
    kicker: "Мій день",
    title: "Призначені позиції",
    hint: "Пакети конструктива та передача в цех",
    nav: CONSTRUCTOR_DESK_TAB,
    navLabel: "Стіл конструктора",
    rows,
    empty: "Немає призначених позицій — очікуйте призначення від начальника виробництва."
  });
}

function renderManagerDay() {
  const items = managerFocusPositions();
  const rows = items.map((p) => {
    const gm = resolvePositionGodmode(p);
    const subtitle =
      p.problem?.trim() ||
      (!p.managerDataComplete
        ? "Потрібні дані менеджера"
        : gm.nextAction?.label || p.positionStatus);
    return rowButton({
      id: p.id,
      title: `${p.orderNumber} · ${p.item || "—"}`,
      subtitle,
      meta: (p.overdueDays ?? 0) > 0 ? `+${p.overdueDays} дн.` : `${p.progress ?? 0}%`
    });
  });
  return sectionShell({
    kicker: "Мій день",
    title: "Ваші пріоритети",
    hint: "Незаповнені дані, дедлайни та блокери",
    nav: ATTENTION_TAB,
    navLabel: "Потребує уваги",
    rows,
    empty: "Усі позиції в порядку — перевірте нові замовлення в реєстрі."
  });
}

function renderProductionDay() {
  const attentionCount = countAttentionItems(attentionFromState(state));
  const preview = productionAttentionPreview();
  const rows = preview.map((item) =>
    rowButton({
      id: item.positionId || null,
      title: item.title || item.message || "Задача",
      subtitle: item.subtitle || item.orderNumber || "",
      nav: !item.positionId && item.orderId ? null : ATTENTION_TAB,
      meta: item.kind === "blocker" ? "Блокер" : "Далі"
    })
  );
  const floorHint = state.productionFloor?.stages?.length
    ? `${state.productionFloor.stages.length} етапів у цеху`
    : "Черги та сесії операторів";
  return sectionShell({
    kicker: "Мій день",
    title: "Операційний фокус",
    hint: `${attentionCount} елементів уваги · ${floorHint}`,
    nav: PRODUCTION_FLOOR_TAB,
    navLabel: "Цех зараз",
    rows,
    empty: "Немає критичних блокерів — перевірте черги на етапах."
  });
}

function renderProcurementDay() {
  const pending = myPositions().filter(
    (p) => p.hasProcurementSource && !p.hasProcurementRequest
  ).length;
  const rows = myPositions()
    .filter((p) => p.hasProcurementSource || p.procurementRequestStatus)
    .slice(0, 5)
    .map((p) =>
      rowButton({
        id: p.id,
        title: `${p.orderNumber} · ${p.item || "—"}`,
        subtitle: p.procurementRequestStatus || "Очікує заявку",
        meta: p.constructivePackageStatus || "—"
      })
    );
  return sectionShell({
    kicker: "Мій день",
    title: "Закупівлі та MTO",
    hint: pending > 0 ? `${pending} поз. з Excel без заявки` : "Календар MTO та склад",
    nav: PROCUREMENT_TAB,
    navLabel: "До закупівель",
    rows,
    empty: "Немає активних заявок — перевірте календар MTO."
  });
}

function renderAdminDay() {
  const problems = myPositions().filter((p) => p.problem?.trim()).length;
  const attentionCount = countAttentionItems(attentionFromState(state));
  return sectionShell({
    kicker: "Мій день",
    title: "Системний огляд",
    hint: `${problems} проблем · ${attentionCount} у фокусі уваги`,
    nav: ATTENTION_TAB,
    navLabel: "Потребує уваги",
    rows: [],
    empty: "Використайте «Потребує уваги» та «Цех зараз» для операційного контролю."
  });
}

/** Персоналізований блок «Мій день» на огляді. */
export function renderMyDaySection() {
  const persona = dashboardPersona();

  let inner = "";
  if (persona === "constructor" && canViewConstructorDesk()) {
    inner = renderConstructorDay();
  } else if (persona === "manager" && canEditOrders()) {
    inner = renderManagerDay();
  } else if (persona === "production" && canViewProductionFloor()) {
    inner = renderProductionDay();
  } else if (persona === "procurement" && canViewProcurement()) {
    inner = renderProcurementDay();
  } else if (persona === "admin") {
    inner = renderAdminDay();
  } else {
    inner = renderManagerDay();
  }

  if (!inner) return "";
  return `<section class="dash-my-day card" role="region" aria-label="Мій день">${inner}</section>`;
}
