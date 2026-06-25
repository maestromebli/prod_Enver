import { canManageProcurement } from "./auth.js";
import {
  bindConstructivePackageBlock,
  bindLegacyConstructiveUpload,
  renderConstructivePackageBlock,
  renderLegacyConstructiveUpload
} from "./constructive-package-ui.js";
import {
  bindConstructivePipelinePanel,
  renderConstructivePipelinePanel
} from "./constructive-pipeline-panel.js";
import { bindLegacyAiBlock, renderLegacyAiBlock } from "./position-legacy-ai.js";

/** Повна вкладка «Конструктив» у картці замовлення. */
export function renderPositionConstructivePanel(position, downstream = {}) {
  const detail = downstream?.packageDetail;
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
      ${renderConstructivePackageBlock(position, detail)}
      ${renderLegacyConstructiveUpload(position)}
      ${renderLegacyAiBlock(position)}
    </div>`;
}

export function bindPositionConstructivePanel(root, position, { downstream, onRefresh } = {}) {
  if (!root || !position?.id) return;

  const stack = root.querySelector(`[data-position-constructive="${position.id}"]`) || root;
  const positionId = position.id;

  const notifyUpdated = (opts = {}) => {
    onRefresh?.({ contentOnly: false, reloadConstructive: true, ...opts });
  };

  bindConstructivePackageBlock(position, stack, { onUpdated: notifyUpdated });
  bindLegacyConstructiveUpload(stack, position, { onUploaded: notifyUpdated });
  bindLegacyAiBlock(stack, position, {
    onUpdated: notifyUpdated,
    showError: (msg) => {
      import("./toast.js").then(({ toastError }) => toastError(msg));
    }
  });

  if (stack.querySelector(".constructive-pipeline-panel")) {
    bindConstructivePipelinePanel(stack, {
      positionId,
      getPackageDetail: () => downstream?.packageDetail,
      getProcurement: () => downstream?.procurement,
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
