import { canManageProcurement } from "./auth.js";
import { state } from "./state.js";
import {
  bindConstructivePackageBlock,
  renderConstructivePackageBlock,
  renderConstructivePackageReadOnly
} from "./constructive-package-ui.js";
import {
  bindConstructivePipelinePanel,
  renderConstructivePipelinePanel
} from "./constructive-pipeline-panel.js";
import { bindLegacyAiBlock, renderLegacyAiBlock } from "./position-legacy-ai.js";
import { refreshStalePackageParseUi } from "./constructive-package-parse-ui.js";

let constructivePackageEventAbort = null;
const constructivePackageEventPositions = new Set();

function ensureConstructivePackageUpdatedListener() {
  if (constructivePackageEventAbort) return;
  constructivePackageEventAbort = new AbortController();
  document.addEventListener(
    "enver:constructive-package-updated",
    (e) => {
      const positionId = Number(e.detail?.positionId);
      if (!positionId || !constructivePackageEventPositions.has(positionId)) return;
      const handler = constructivePackageRefreshHandlers.get(positionId);
      const packageDetail = e.detail?.packageDetail;
      if (packageDetail) {
        handler?.({ packageDomOnly: true, packageDetail });
        return;
      }
      handler?.({ reloadConstructive: true });
    },
    { signal: constructivePackageEventAbort.signal }
  );
}

/** @type {Map<number, (opts?: object) => void | Promise<void>>} */
const constructivePackageRefreshHandlers = new Map();

function renderConstructiveStackInner(
  position,
  downstream = {},
  { editable = false, hideProcurement = false } = {}
) {
  const detail = downstream?.packageDetail;

  if (!editable) {
    return renderConstructivePackageReadOnly(position, detail, {
      legacyFiles: downstream?.constructiveFiles || []
    });
  }

  const hasPackage = Boolean(detail?.package);
  const pipeline = hasPackage
    ? renderConstructivePipelinePanel(detail, downstream?.procurement, {
        canManageProcurement: canManageProcurement(),
        cncJobs: downstream?.cncJobs || [],
        hideProcurement
      })
    : "";

  return `
    ${pipeline}
    ${renderConstructivePackageBlock(position, detail, {
      editable: true,
      constructiveFiles: downstream?.constructiveFiles || [],
      hideProcurement
    })}
    ${hasPackage ? "" : renderLegacyAiBlock(position)}`;
}

/** Вкладка «Пакет конструктива» у картці замовлення (read-only) або на столі конструктора (edit). */
export function renderPositionConstructivePanel(
  position,
  downstream = {},
  { editable = false, hideProcurement = false } = {}
) {
  const readonlyClass = editable ? "" : " position-constructive-stack--readonly";

  return `
    <div class="position-constructive-stack${readonlyClass}" data-position-constructive="${position.id}">
      ${renderConstructiveStackInner(position, downstream, { editable, hideProcurement })}
    </div>`;
}

/** Перемалювати stack без повного renderApp (після видалення файлу тощо). */
export function remountPositionConstructivePanel(
  root,
  position,
  {
    downstream,
    getDownstream,
    onRefresh,
    onPackageDetailPatched,
    editable = false,
    hideProcurement = false
  } = {}
) {
  if (!root || !position?.id) return;

  const resolvedDownstream = getDownstream?.() ?? downstream ?? {};

  const stack =
    root.querySelector(`[data-position-constructive="${position.id}"]`) ||
    (root.matches?.(`[data-position-constructive="${position.id}"]`) ? root : null);
  if (!stack) return;

  stack.innerHTML = renderConstructiveStackInner(position, resolvedDownstream, {
    editable,
    hideProcurement
  });

  bindPositionConstructivePanel(root, position, {
    downstream: resolvedDownstream,
    getDownstream,
    onRefresh,
    onPackageDetailPatched,
    editable,
    hideProcurement
  });
}

export function bindPositionConstructivePanel(
  root,
  position,
  {
    downstream,
    getDownstream,
    onRefresh,
    onPackageDetailPatched,
    editable = false,
    hideProcurement = false
  } = {}
) {
  if (!root || !position?.id) return;

  const stack = root.querySelector(`[data-position-constructive="${position.id}"]`) || root;
  const positionId = position.id;
  const resolveDownstream = () => getDownstream?.() ?? downstream ?? {};

  if (!editable) {
    stack.querySelector("[data-open-constructor-ws]")?.addEventListener("click", async () => {
      const { openConstructorWorkspace } = await import("./constructor-desk.js");
      await openConstructorWorkspace(positionId, { workspaceTab: "package" });
    });
    const block = stack.querySelector(".constructive-package-block");
    const detail = resolveDownstream().packageDetail;
    if (block && detail?.package) {
      void refreshStalePackageParseUi(block, position, detail, (_packageId) => {
        void (async () => {
          const { requestAutoParsePackage, runAutoParsePackageIfRequested } =
            await import("./constructive-package-parse-ui.js");
          const { canWorkConstructorDesk } = await import("./auth.js");
          if (canWorkConstructorDesk()) {
            requestAutoParsePackage(positionId);
            await runAutoParsePackageIfRequested(positionId, {
              root: stack,
              position,
              liveCtx: { detail },
              notify: () => onRefresh?.({ reloadConstructive: true })
            });
            return;
          }
          const { openConstructorWorkspace } = await import("./constructor-desk.js");
          await openConstructorWorkspace(positionId, {
            workspaceTab: "package",
            autoParse: true
          });
        })();
      });
    }
    return;
  }

  const notifyUpdated = async (opts = {}) => {
    let current = resolveDownstream();
    if (opts.packageDetail) {
      current = { ...current, packageDetail: opts.packageDetail };
      onPackageDetailPatched?.(opts.packageDetail);
      if (state.constructorDesk.selectedPositionId === positionId) {
        state.constructorDesk.packageDetail = opts.packageDetail;
      }
      const downstreamState = state.ordersView.positionTabDownstream?.[positionId];
      if (downstreamState) {
        state.ordersView.positionTabDownstream = {
          ...state.ordersView.positionTabDownstream,
          [positionId]: { ...downstreamState, packageDetail: opts.packageDetail }
        };
      }
    }
    if (opts.packageDomOnly) {
      remountPositionConstructivePanel(root, position, {
        downstream: current,
        getDownstream,
        onRefresh,
        onPackageDetailPatched,
        editable: true,
        hideProcurement
      });
      return;
    }
    onRefresh?.({ contentOnly: false, reloadConstructive: true, ...opts });
  };

  constructivePackageRefreshHandlers.set(positionId, notifyUpdated);
  constructivePackageEventPositions.add(positionId);
  ensureConstructivePackageUpdatedListener();

  const current = resolveDownstream();

  bindConstructivePackageBlock(position, stack, {
    editable: true,
    detail: current.packageDetail,
    constructiveFiles: current.constructiveFiles || [],
    hideProcurement,
    onDetailPatched: (nextDetail) => {
      onPackageDetailPatched?.(nextDetail);
      if (state.constructorDesk.selectedPositionId === positionId) {
        state.constructorDesk.packageDetail = nextDetail;
      }
      const downstreamState = state.ordersView.positionTabDownstream?.[positionId];
      if (downstreamState) {
        state.ordersView.positionTabDownstream = {
          ...state.ordersView.positionTabDownstream,
          [positionId]: { ...downstreamState, packageDetail: nextDetail }
        };
      }
    },
    onUpdated: notifyUpdated
  });
  if (stack.querySelector("[data-legacy-ai]")) {
    bindLegacyAiBlock(stack, position, {
      onUpdated: notifyUpdated,
      showError: (msg) => {
        import("./toast.js").then(({ toastError }) => toastError(msg));
      }
    });
  }

  if (stack.querySelector(".constructive-pipeline-panel")) {
    bindConstructivePipelinePanel(stack, {
      positionId,
      hideProcurement,
      getPackageDetail: () =>
        state.constructorDesk.packageDetail ??
        state.ordersView.positionTabDownstream?.[positionId]?.packageDetail ??
        resolveDownstream().packageDetail,
      getProcurement: () =>
        state.constructorDesk.packageDetail?.procurement ??
        state.ordersView.positionTabDownstream?.[positionId]?.procurement ??
        resolveDownstream().procurement,
      onProcurementUpdated: () => notifyUpdated(),
      onPackageUpdated: () => notifyUpdated(),
      onOpenPosition: () => onRefresh?.({ contentOnly: false })
    });
  }
}

export function unregisterPositionConstructivePanel(positionId) {
  if (!positionId) return;
  constructivePackageRefreshHandlers.delete(Number(positionId));
  constructivePackageEventPositions.delete(Number(positionId));
}
