import { canManageProcurement } from "./auth.js";
import { state } from "./state.js";
import {
  bindConstructivePackageBlock,
  bindLegacyConstructiveUpload,
  renderConstructivePackageBlock,
  renderConstructivePackageReadOnly,
  renderLegacyConstructiveUpload
} from "./constructive-package-ui.js";
import {
  bindConstructivePipelinePanel,
  renderConstructivePipelinePanel
} from "./constructive-pipeline-panel.js";
import { bindLegacyAiBlock, renderLegacyAiBlock } from "./position-legacy-ai.js";

/** Вкладка «Пакет конструктива» у картці замовлення (read-only) або на столі конструктора (edit). */
export function renderPositionConstructivePanel(
  position,
  downstream = {},
  { editable = false } = {}
) {
  const detail = downstream?.packageDetail;

  if (!editable) {
    return `
      <div class="position-constructive-stack position-constructive-stack--readonly" data-position-constructive="${position.id}">
        ${renderConstructivePackageReadOnly(position, detail)}
      </div>`;
  }

  const hasPackage = Boolean(detail?.package);
  const pipeline = hasPackage
    ? renderConstructivePipelinePanel(detail, downstream?.procurement, {
        canManageProcurement: canManageProcurement(),
        cncJobs: downstream?.cncJobs || []
      })
    : "";

  return `
    <div class="position-constructive-stack" data-position-constructive="${position.id}">
      ${pipeline}
      ${renderConstructivePackageBlock(position, detail, { editable: true })}
      ${renderLegacyConstructiveUpload(position, { editable: true })}
      ${renderLegacyAiBlock(position)}
    </div>`;
}

export function bindPositionConstructivePanel(
  root,
  position,
  { downstream, onRefresh, editable = false } = {}
) {
  if (!root || !position?.id) return;

  const stack = root.querySelector(`[data-position-constructive="${position.id}"]`) || root;
  const positionId = position.id;

  if (!editable) {
    stack.querySelector("[data-open-constructor-ws]")?.addEventListener("click", async () => {
      const { openConstructorWorkspace } = await import("./constructor-desk.js");
      await openConstructorWorkspace(positionId, { workspaceTab: "package" });
    });
    return;
  }

  const notifyUpdated = (opts = {}) => {
    onRefresh?.({ contentOnly: false, reloadConstructive: true, ...opts });
  };

  bindConstructivePackageBlock(position, stack, { editable: true, onUpdated: notifyUpdated });
  bindLegacyConstructiveUpload(stack, position, { editable: true, onUploaded: notifyUpdated });
  bindLegacyAiBlock(stack, position, {
    onUpdated: notifyUpdated,
    showError: (msg) => {
      import("./toast.js").then(({ toastError }) => toastError(msg));
    }
  });

  if (stack.querySelector(".constructive-pipeline-panel")) {
    bindConstructivePipelinePanel(stack, {
      positionId,
      getPackageDetail: () =>
        state.constructorDesk.packageDetail ??
        state.ordersView.positionTabDownstream?.[positionId]?.packageDetail ??
        downstream?.packageDetail,
      getProcurement: () =>
        state.constructorDesk.packageDetail?.procurement ??
        state.ordersView.positionTabDownstream?.[positionId]?.procurement ??
        downstream?.procurement,
      onProcurementUpdated: () => notifyUpdated(),
      onPackageUpdated: () => notifyUpdated(),
      onOpenPosition: () => onRefresh?.({ contentOnly: false })
    });
  }

  if (!stack.dataset.cpEventBound) {
    stack.dataset.cpEventBound = "1";
    document.addEventListener("enver:constructive-package-updated", () => {
      if (document.querySelector(`[data-position-constructive="${positionId}"]`)) {
        notifyUpdated();
      }
    });
  }
}
