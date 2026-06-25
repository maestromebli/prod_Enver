import { api } from "./api.js";
import { canManageProcurement, canViewFinance } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { renderPositionManagerPanel, bindPositionManagerPanel } from "./position-manager-panel.js";
import { renderNextActionBanner, resolvePositionGodmode } from "./godmode-ui.js";
import {
  loadCncJobsSummary,
  loadFinanceSummary,
  loadProcurementSummary,
  bindConstructivePipelinePanel,
  renderCncQueuePanel,
  renderFinancePanel,
  renderProcurementPanel
} from "./constructive-pipeline-panel.js";
import {
  bindPositionConstructivePanel,
  renderPositionConstructivePanel
} from "./position-constructive-panel.js";
import { bindPositionInstallPanel, renderPositionInstallPanel } from "./position-install-panel.js";
import {
  bindPositionOperatorPanel,
  renderPositionOperatorPanel
} from "./position-operator-panel.js";
import { formatHistoryTime, renderChangesList } from "./history.js";
import { state } from "./state.js";

const SUB_TABS = [
  { key: "manager", label: "Дані" },
  { key: "constructive", label: "Конструктив" },
  { key: "procurement", label: "Закупівля" },
  { key: "finance", label: "Фінанси" },
  { key: "cnc", label: "ЧПК" },
  { key: "install", label: "Монтаж" },
  { key: "operator", label: "Оператор" },
  { key: "history", label: "Історія" }
];

const tabDataCache = new Map();

function cacheKey(positionId, subTab) {
  return `${positionId}:${subTab}`;
}

function renderSubTabs(positionId, activeSub) {
  const buttons = SUB_TABS.filter((t) => {
    if (t.key === "finance" && !canViewFinance()) return false;
    return true;
  })
    .map(
      (t) =>
        `<button type="button" class="enver-segmented-btn ${activeSub === t.key ? "active" : ""}" data-pos-sub-tab="${t.key}" data-position-id="${positionId}">${t.label}</button>`
    )
    .join("");
  return `<nav class="enver-segmented pos-sub-tabs" role="tablist">${buttons}</nav>`;
}

function renderHistoryBlock(position) {
  const entries = (state.history || []).filter(
    (e) =>
      (e.entityType === "position" && e.entityId === position.id) ||
      e.itemLabel === position.item ||
      e.orderNumber === position.orderNumber
  );
  if (!entries.length) {
    return `<p class="enver-meta">Історія позиції порожня.</p>`;
  }
  return entries
    .slice(0, 30)
    .map(
      (e) => `
      <article class="order-history-row">
        <time>${escapeHtml(formatHistoryTime(e.createdAt))}</time>
        <span class="enver-badge enver-badge-info">${escapeHtml(e.actionLabel || e.action)}</span>
        <p>${escapeHtml(e.summary || "—")}</p>
        ${renderChangesList(e.changes)}
      </article>`
    )
    .join("");
}

export function renderPositionOrderTab(
  position,
  bundle,
  { subTab = "manager", downstream = null } = {}
) {
  const gm = resolvePositionGodmode(position);
  const activeSub = subTab || "manager";
  let body = "";

  if (activeSub === "manager") {
    body = renderPositionManagerPanel(position, bundle);
  } else if (activeSub === "constructive") {
    body =
      downstream != null
        ? renderPositionConstructivePanel(position, downstream)
        : `<p class="enver-meta">Завантаження конструктива…</p>`;
  } else if (activeSub === "procurement") {
    body = renderProcurementPanel(downstream?.procurement, { canManage: canManageProcurement() });
  } else if (activeSub === "finance") {
    body = renderFinancePanel(position.id, downstream?.finance);
  } else if (activeSub === "cnc") {
    body = renderCncQueuePanel(downstream?.cncJobs || []);
  } else if (activeSub === "install") {
    body = renderPositionInstallPanel(position);
  } else if (activeSub === "operator") {
    body = renderPositionOperatorPanel(position);
  } else if (activeSub === "history") {
    body = `<div class="order-history-list">${renderHistoryBlock(position)}</div>`;
  }

  return `
    <section class="order-position-tab card" role="tabpanel" data-position-tab="${position.id}">
      ${renderNextActionBanner(gm, { positionId: position.id, showCta: true })}
      ${renderSubTabs(position.id, activeSub)}
      <div class="pos-sub-panel" data-pos-sub-panel="${position.id}">${body}</div>
      <div class="order-position-meta">
        <button type="button" class="btn btn-sm" data-open-position="${position.id}">Повна картка позиції</button>
        <button type="button" class="btn btn-sm btn-ghost" data-open-constructor-ws="${position.id}">Стіл конструктора</button>
      </div>
    </section>`;
}

export async function loadPositionOrderTabData(positionId, subTab) {
  const key = cacheKey(positionId, subTab);
  if (tabDataCache.has(key)) return tabDataCache.get(key);

  let data = {};
  if (subTab === "constructive") {
    const [packageDetail, procurement, cncJobs] = await Promise.all([
      api.getConstructivePackageLatest(positionId).catch(() => null),
      loadProcurementSummary(positionId),
      loadCncJobsSummary(positionId)
    ]);
    data = { packageDetail, procurement, cncJobs };
  } else if (subTab === "procurement") {
    data.procurement = await loadProcurementSummary(positionId);
  } else if (subTab === "finance") {
    data.finance = await loadFinanceSummary(positionId);
  } else if (subTab === "cnc") {
    data.cncJobs = await loadCncJobsSummary(positionId);
  }

  tabDataCache.set(key, data);
  return data;
}

export function clearPositionOrderTabCache(positionId) {
  for (const key of [...tabDataCache.keys()]) {
    if (key.startsWith(`${positionId}:`)) tabDataCache.delete(key);
  }
}

export function clearAllPositionOrderTabCache() {
  tabDataCache.clear();
}

export function bindPositionOrderTab(
  root,
  position,
  bundle,
  { subTab, onRefresh, onOpenConstructor, onOpenPosition }
) {
  const positionId = position.id;
  const activeSub = subTab || "manager";

  const reloadConstructiveTab = async () => {
    clearPositionOrderTabCache(positionId);
    const data = await loadPositionOrderTabData(positionId, "constructive");
    state.ordersView.positionTabDownstream = {
      ...(state.ordersView.positionTabDownstream || {}),
      [positionId]: { ...(state.ordersView.positionTabDownstream?.[positionId] || {}), ...data }
    };
    onRefresh?.({ contentOnly: true });
  };

  const handlePositionRefresh = (opts = {}) => {
    if (opts.reloadConstructive) {
      reloadConstructiveTab().catch(() => onRefresh?.({ contentOnly: false }));
      return;
    }
    if (!opts.contentOnly) clearPositionOrderTabCache(positionId);
    onRefresh?.(opts);
  };

  root.querySelectorAll("[data-pos-sub-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const positionId = Number(btn.dataset.positionId);
      const nextSub = btn.dataset.posSubTab;
      state.ordersView.positionSubTab = state.ordersView.positionSubTab || {};
      state.ordersView.positionSubTab[positionId] = nextSub;
      clearPositionOrderTabCache(positionId);
      if (nextSub !== "manager") {
        loadPositionOrderTabData(positionId, nextSub)
          .then((data) => {
            state.ordersView.positionTabDownstream = {
              ...(state.ordersView.positionTabDownstream || {}),
              [positionId]: data
            };
            onRefresh?.({ contentOnly: true });
          })
          .catch(() => onRefresh?.({ contentOnly: true }));
      } else {
        onRefresh?.({ contentOnly: true });
      }
    });
  });

  root.querySelector("[data-open-constructor-ws]")?.addEventListener("click", () => {
    onOpenConstructor?.(positionId);
  });

  if (activeSub === "manager") {
    bindPositionManagerPanel(root, {
      positionId,
      onSaved: async () => {
        clearPositionOrderTabCache(positionId);
        await handlePositionRefresh({ contentOnly: false });
      }
    });
  }

  if (activeSub === "install") {
    bindPositionInstallPanel(root, position, {
      onSaved: async () => {
        const { refreshAppData } = await import("./data-sync.js");
        await refreshAppData({ includeDirectories: false, syncViews: true });
        handlePositionRefresh({ contentOnly: false });
      }
    });
  }

  if (activeSub === "operator") {
    bindPositionOperatorPanel(root, position);
  }

  const panel = root.querySelector(`[data-pos-sub-panel="${positionId}"]`);
  if (activeSub === "constructive" && panel) {
    const downstream = state.ordersView.positionTabDownstream?.[positionId];
    bindPositionConstructivePanel(panel, position, {
      downstream,
      onRefresh: handlePositionRefresh
    });
  }

  if (activeSub === "procurement" && panel) {
    bindConstructivePipelinePanel(panel, {
      positionId,
      getProcurement: () => state.ordersView.positionTabDownstream?.[positionId]?.procurement,
      onProcurementUpdated: (procurement) => {
        state.ordersView.positionTabDownstream = {
          ...(state.ordersView.positionTabDownstream || {}),
          [positionId]: { procurement }
        };
        onRefresh?.({ contentOnly: true });
      },
      onOpenPosition
    });
  }
}

export function getPositionSubTab(positionId) {
  return state.ordersView.positionSubTab?.[positionId] || "manager";
}
