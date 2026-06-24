import { canEditOrders, canEditPositions, isOperator } from "./auth.js";
import { PRODUCTION_FLOOR_TAB, ATTENTION_TAB } from "./constants.js";
import { activePositions } from "./archive.js";
import { countAttentionItems } from "./attention.js";
import { resolveOrderGodmode, resolvePositionGodmode } from "./godmode-ui.js";
import { isRunnableGodmodeAction } from "@enver/shared/production/godmode-ui-helpers.js";
import { $ } from "./utils.js";

function countByStatus(positions, status) {
  return positions.filter((p) => p.status === status).length;
}

/** Підказки з godmode — головна дія по позиції або замовленню. */
function collectGodmodeHints(state) {
  const hints = [];
  const positions = activePositions(state.positions, state.orders).filter((p) => !p.parentId);

  const top = [...positions].sort(
    (a, b) =>
      (resolvePositionGodmode(b).attentionScore || 0) -
      (resolvePositionGodmode(a).attentionScore || 0)
  )[0];

  if (top) {
    const gm = resolvePositionGodmode(top);
    const next = gm.nextAction;
    if (next?.label && (gm.attentionScore || 0) >= 40 && isRunnableGodmodeAction(next.type)) {
      hints.push({
        priority: gm.health === "blocked" ? "high" : "normal",
        text: `${top.orderNumber} · ${top.item}: ${next.label}`,
        godmodeAction: { entityType: "position", entityId: top.id, actionType: next.type },
        source: "godmode"
      });
    }
  }

  for (const order of state.orders || []) {
    if (order.status === "Завершено") continue;
    const gm = resolveOrderGodmode(order, state.positions);
    if (gm.nextAction?.type === "close_order") {
      hints.push({
        priority: "normal",
        text: `Замовлення ${order.orderNumber} готове до закриття.`,
        godmodeAction: { entityType: "order", entityId: order.id, actionType: "close_order" },
        source: "godmode"
      });
    }
  }

  return hints;
}

function overduePositions(positions) {
  return positions.filter((p) => Number(p.overdueDays) > 0);
}

function withoutConstructive(positions) {
  return positions.filter((p) => !p.parentId && !p.hasConstructiveFile);
}

/** Миттєві підказки з локального стану — працюють без OpenAI. */
export function collectLocalHints(state) {
  const hints = [];
  const positions = activePositions(state.positions, state.orders);
  const k = state.kpis;

  if (state.view === "operator") {
    const stage = state.operatorStage || "—";
    const queue = state.operatorQueue?.length ?? 0;
    if (queue > 0) {
      hints.push({
        priority: "high",
        text: `У черзі ${queue} завдань на етапі «${stage}». Візьміть наступне або продовжіть активне.`,
        source: "local"
      });
    } else {
      hints.push({
        priority: "normal",
        text: "Черга порожня — перевірте, чи менеджер передав позиції на ваш етап.",
        source: "local"
      });
    }
    if (state.operatorActiveSession) {
      hints.push({
        priority: "high",
        text: "Є активна сесія — завершіть або поставте на паузу перед новим завданням.",
        source: "local"
      });
    }
    return hints;
  }

  if (state.view === "settings") {
    hints.push({
      priority: "normal",
      text: "У розділі «ШІ» увімкніть аналіз і додайте API ключ — помічник стане розумнішим.",
      source: "local"
    });
    return hints;
  }

  const overdue = overduePositions(positions);
  const attentionCount = countAttentionItems(positions, state.orders);
  if (attentionCount > 0) {
    hints.push({
      priority: "high",
      text: `${attentionCount} елементів потребують уваги — відкрийте екран «Потребує уваги».`,
      action: ATTENTION_TAB,
      source: "local"
    });
  } else if (overdue.length > 0) {
    hints.push({
      priority: "high",
      text: `${overdue.length} позицій прострочено — перевірте дати готовності та етапи.`,
      action: "Позиції",
      source: "local"
    });
  }

  const problems = countByStatus(positions, "Проблема");
  if (problems > 0) {
    hints.push({
      priority: "high",
      text: `${problems} позицій зі статусом «Проблема» — з’ясуйте причину в примітці.`,
      action: "Проблеми",
      source: "local"
    });
  }

  if (k?.readyInstall > 0 && state.activeTab !== "Встановлення") {
    hints.push({
      priority: "normal",
      text: `${k.readyInstall} позицій готові до монтажу — заплануйте дату у календарі встановлення.`,
      action: "Встановлення",
      source: "local"
    });
  }

  if (state.activeTab === "Замовлення" && !state.selectedOrderId) {
    if (state.orders.length === 0 && canEditOrders()) {
      hints.push({
        priority: "high",
        text: "Створіть перше замовлення — кнопка «+ Нове замовлення» у панелі інструментів.",
        source: "local"
      });
    } else {
      hints.push({
        priority: "normal",
        text: "Відкрийте картку замовлення, щоб бачити позиції та прогрес виробництва.",
        source: "local"
      });
    }
  }

  if (state.activeTab === "Замовлення" && state.selectedOrderId && canEditPositions()) {
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    const related = positions.filter((p) => p.orderId === state.selectedOrderId);
    if (related.length === 0) {
      hints.push({
        priority: "high",
        text: `У замовленні ${order?.orderNumber || ""} ще немає позицій — додайте основну позицію.`,
        source: "local"
      });
    }
  }

  if (state.activeTab === "Позиції" || state.selectedOrderId) {
    const noFile = withoutConstructive(positions);
    if (noFile.length > 0 && canEditPositions()) {
      hints.push({
        priority: "normal",
        text: `${noFile.length} позицій без файлу конструктива — завантажте для ШІ-аналізу та передачі в цех.`,
        source: "local"
      });
    }
  }

  if (state.activeTab === ATTENTION_TAB) {
    hints.push({
      priority: "normal",
      text: "Натисніть на рядок, щоб відкрити позицію або замовлення з блокером.",
      source: "local"
    });
  }

  if (state.activeTab === PRODUCTION_FLOOR_TAB) {
    hints.push({
      priority: "normal",
      text: "Оновіть зведення цеху — перевірте черги та проблемні позиції на кожному етапі.",
      source: "local"
    });
  }

  const search = $("#searchInput")?.value?.trim();
  const status = $("#statusFilter")?.value;
  if (search || status) {
    hints.push({
      priority: "normal",
      text: "Застосовано фільтри — натисніть «Скинути», щоб побачити всі позиції.",
      source: "local"
    });
  }

  if (hints.length === 0) {
    hints.push({
      priority: "normal",
      text: isOperator()
        ? "Усе під контролем. Запитайте помічника, якщо потрібна допомога з завданням."
        : "Система в нормі. Запитайте ШІ, що зробити далі, або пройдіть швидкий тур.",
      source: "local"
    });
  }

  const godmodeHints = collectGodmodeHints(state);
  return [...godmodeHints, ...hints].slice(0, 8);
}

/** Контекст для API ШІ — компактний знімок екрану. */
export function buildAssistantContext(state) {
  const positions = activePositions(state.positions, state.orders);
  const overdue = overduePositions(positions);
  const problems = positions.filter((p) => p.status === "Проблема");

  const ctx = {
    view: state.view,
    tab: state.activeTab,
    role: state.currentUser?.role || "",
    userName: state.currentUser?.name || "",
    kpis: state.kpis
      ? {
          activeOrders: state.kpis.activeOrders,
          inProduction: state.kpis.inProduction,
          overdueCount: state.kpis.overdueCount,
          readyInstall: state.kpis.readyInstall
        }
      : null,
    counts: {
      overdue: overdue.length,
      problems: problems.length,
      withoutConstructive: withoutConstructive(positions).length,
      attention: countAttentionItems(positions, state.orders)
    },
    overdueItems: overdue.slice(0, 5).map((p) => `${p.orderNumber} / ${p.item}`),
    problemItems: problems.slice(0, 5).map((p) => `${p.orderNumber} / ${p.item}`),
    filters: {
      search: $("#searchInput")?.value?.trim() || "",
      status: $("#statusFilter")?.value || ""
    }
  };

  if (state.selectedOrderId) {
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (order) ctx.selectedOrderNumber = order.orderNumber;
  }

  if (state.operatorStage) {
    ctx.operatorStage = state.operatorStage;
  }

  return ctx;
}

export function mergeHints(local, remote) {
  const seen = new Set();
  const merged = [];
  for (const h of [...(remote || []), ...(local || [])]) {
    const key = h.text?.slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(h);
  }
  return merged.slice(0, 8);
}
