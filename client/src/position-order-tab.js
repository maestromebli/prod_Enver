import { api } from "./api.js";
import { canManageProcurement, canManageConstructorDesk, canWorkConstructorDesk } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { renderPositionManagerPanel } from "./position-manager-panel.js";
import { renderNextActionBanner, resolvePositionGodmode } from "./godmode-ui.js";
import {
  loadCncJobsSummary,
  loadProcurementSummary,
  bindConstructivePipelinePanel,
  renderCncQueuePanel,
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
import {
  bindPositionResponsiblesPanel,
  loadResponsiblesPanelData,
  renderPositionResponsiblesPanel,
  shouldShowResponsiblesPanel
} from "./position-responsibles-panel.js";
import { formatHistoryTime, renderChangesList } from "./history.js";
import { state } from "./state.js";
import { bindPositionWorkspaceBar, renderPositionWorkspaceBar } from "./position-workspace.js";

const SUB_TABS = [
  { key: "manager", label: "Дані" },
  { key: "constructive", label: "Пакет конструктива" },
  { key: "procurement", label: "Закупівля" },
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
  const buttons = SUB_TABS.map(
    (t) =>
      `<button type="button" class="enver-segmented-btn ${activeSub === t.key ? "active" : ""}" data-pos-sub-tab="${t.key}" data-position-id="${positionId}">${t.label}</button>`
  ).join("");
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
  const constructors = state.ordersView.constructorAssignees || [];
  let body = "";

  const constructiveEditable = canWorkConstructorDesk();

  if (activeSub === "manager") {
    body = renderPositionManagerPanel(position, bundle, { editable: false });
  } else if (activeSub === "constructive") {
    body =
      downstream != null
        ? renderPositionConstructivePanel(position, downstream, {
            editable: constructiveEditable
          })
        : `<p class="enver-meta">Завантаження пакета конструктива…</p>`;
  } else if (activeSub === "procurement") {
    body = renderProcurementPanel(downstream?.procurement, { canManage: canManageProcurement() });
  } else if (activeSub === "cnc") {
    body = renderCncQueuePanel(downstream?.cncJobs || [], {
      packageFiles: downstream?.packageFiles || []
    });
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
      ${renderPositionResponsiblesPanel(position, constructors)}
      ${renderSubTabs(position.id, activeSub)}
      <div class="pos-sub-panel" data-pos-sub-panel="${position.id}">${body}</div>
      ${renderPositionWorkspaceBar(position)}
    </section>`;
}

export async function loadPositionOrderTabData(positionId, subTab) {
  const key = cacheKey(positionId, subTab);
  if (tabDataCache.has(key)) return tabDataCache.get(key);

  let data = {};
  if (subTab === "constructive") {
    const [packageDetail, procurement, cncJobs, constructiveFiles] = await Promise.all([
      api.getConstructivePackageLatest(positionId).catch(() => null),
      loadProcurementSummary(positionId),
      loadCncJobsSummary(positionId),
      api.getConstructiveFiles(positionId).catch(() => [])
    ]);
    data = { packageDetail, procurement, cncJobs, constructiveFiles };
  } else if (subTab === "procurement") {
    data.procurement = await loadProcurementSummary(positionId);
  } else if (subTab === "cnc") {
    const [cncJobs, packageDetail] = await Promise.all([
      loadCncJobsSummary(positionId),
      api.getConstructivePackageLatest(positionId).catch(() => null)
    ]);
    data = { cncJobs, packageFiles: packageDetail?.files || [] };
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
  { subTab, onRefresh, onOpenConstructor: _onOpenConstructor, onOpenPosition }
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

  bindPositionWorkspaceBar(root);

  root.querySelector("[data-open-constructor-ws]")?.addEventListener("click", async () => {
    const { openConstructorWorkspace } = await import("./constructor-desk.js");
    await openConstructorWorkspace(positionId);
  });

  if (shouldShowResponsiblesPanel(position)) {
    bindPositionResponsiblesPanel(root, position, {
      onSaved: async () => {
        const { refreshAppData } = await import("./data-sync.js");
        await refreshAppData({ includeDirectories: false, syncViews: true });
        await handlePositionRefresh({ contentOnly: true });
      }
    });
    if (!state.ordersView.constructorAssignees?.length && canManageConstructorDesk()) {
      loadResponsiblesPanelData()
        .then((list) => {
          state.ordersView.constructorAssignees = list;
          onRefresh?.({ contentOnly: true });
        })
        .catch(() => {});
    }
    const focusId = state.ordersView.focusResponsiblesPositionId;
    if (focusId === positionId) {
      state.ordersView.focusResponsiblesPositionId = null;
      requestAnimationFrame(() => {
        document.getElementById(`positionResponsibles-${positionId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
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
    const constructiveEditable = canWorkConstructorDesk();
    bindPositionConstructivePanel(panel, position, {
      downstream,
      editable: constructiveEditable,
      onRefresh: handlePositionRefresh,
      onPackageDetailPatched: (packageDetail) => {
        state.ordersView.positionTabDownstream = {
          ...(state.ordersView.positionTabDownstream || {}),
          [positionId]: {
            ...(state.ordersView.positionTabDownstream?.[positionId] || {}),
            packageDetail
          }
        };
      },
      onOpenConstructor: async () => {
        const { openConstructorWorkspace } = await import("./constructor-desk.js");
        await openConstructorWorkspace(positionId, { workspaceTab: "package" });
      }
    });

    if (constructiveEditable) {
      void (async () => {
        const { runAutoParsePackageIfRequested } =
          await import("./constructive-package-parse-ui.js");
        const stack = panel.querySelector(`[data-position-constructive="${positionId}"]`) || panel;
        await runAutoParsePackageIfRequested(positionId, {
          root: stack,
          position,
          liveCtx: { detail: downstream?.packageDetail },
          notify: () => handlePositionRefresh({ reloadConstructive: true })
        });
      })();
    }
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
