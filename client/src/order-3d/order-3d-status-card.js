import { escapeHtml } from "../utils.js";
import { ORDER_3D_STATUS_LABELS } from "@enver/shared/production/order-3d.js";
import { order3dFileUrl } from "./order-3d-api.js";

export function renderOrder3DStatusCard(asset, orderId) {
  if (!asset) return "";

  const label = ORDER_3D_STATUS_LABELS[asset.status] || asset.status;
  const statusClass = `order-3d-status--${String(asset.status || "").toLowerCase()}`;

  return `
    <div class="order-3d-status-card card ${statusClass}">
      <div class="order-3d-status-head">
        <span class="enver-badge order-3d-status-badge">${escapeHtml(label)}</span>
        <span class="enver-meta">${escapeHtml(asset.originalFileName || "")}</span>
      </div>
      ${
        asset.status === "CONVERTING"
          ? `<p class="order-3d-status-text">Аналізуємо .b3d: BZ85 → zlib → словник полів → геометрія → GLB.</p>
             <div class="order-3d-loader" aria-hidden="true"></div>`
          : ""
      }
      ${
        (asset.status === "READY" || asset.status === "PARTIAL_READY") && asset.conversionHint
          ? `<p class="order-3d-status-text order-3d-status-text--hint">${escapeHtml(asset.conversionHint)}</p>`
          : ""
      }
      ${
        (asset.status === "READY" || asset.status === "PARTIAL_READY") &&
        asset.conversionSourceLabel
          ? `<p class="order-3d-status-text order-3d-status-text--source enver-meta">Джерело: ${escapeHtml(asset.conversionSourceLabel)}</p>`
          : ""
      }
      ${
        asset.status === "PARTIAL_READY"
          ? `<p class="order-3d-status-text order-3d-status-text--partial">Експериментальна модель з Bazis .b3d — геометрія може бути неповною.</p>`
          : ""
      }
      ${
        asset.status === "FAILED"
          ? `<p class="order-3d-status-text order-3d-status-text--error">${escapeHtml(asset.errorMessage || "Помилка обробки")}</p>`
          : ""
      }
      ${
        asset.status === "NEED_MANUAL_RESEARCH" || asset.status === "NEED_MANUAL_CHECK"
          ? `<p class="order-3d-status-text">Автоматична збірка 3D з .b3d не вдалась. Оригінал і report.json збережено для подальшого дослідження.</p>
             ${asset.errorMessage ? `<p class="enver-meta">${escapeHtml(asset.errorMessage)}</p>` : ""}
             ${
               asset.previewImageUrl
                 ? `<div class="order-3d-preview-fallback"><img src="${escapeHtml(order3dFileUrl(orderId ?? asset.orderId, asset.id, "preview"))}" alt="PNG превʼю з .b3d" class="order-3d-preview-img" /></div>`
                 : ""
             }`
          : ""
      }
    </div>`;
}
