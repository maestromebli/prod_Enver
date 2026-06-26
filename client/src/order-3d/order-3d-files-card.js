import { escapeHtml } from "../utils.js";
import { canDownloadWebModel, canViewOriginalB3D, canViewB3DReport } from "./order-3d-permissions.js";
import { order3dFileUrl } from "./order-3d-api.js";

export function renderOrder3DFilesCard(orderId, asset) {
  if (!asset) return "";

  const rows = [];
  if (asset.originalFileUrl && canViewOriginalB3D()) {
    rows.push({
      title: "Оригінал БАЗІС",
      href: order3dFileUrl(orderId, asset.id, "original"),
      name: asset.originalFileName
    });
  }
  if (asset.webModelUrl) {
    rows.push({
      title: "Web-модель",
      href: order3dFileUrl(orderId, asset.id, "web-model"),
      name: "model.glb",
      hidden: !canDownloadWebModel()
    });
  }
  if (asset.previewImageUrl) {
    rows.push({
      title: "Превʼю",
      href: order3dFileUrl(orderId, asset.id, "preview"),
      name: "preview.png"
    });
  }
  if (asset.reportUrl && canViewB3DReport()) {
    rows.push({
      title: "B3D report",
      href: order3dFileUrl(orderId, asset.id, "report"),
      name: "report.json"
    });
  }

  if (!rows.length) {
    return `<div class="order-3d-files-card card"><p class="enver-meta">Файли зʼявляться після обробки.</p></div>`;
  }

  const items = rows
    .map((r) => {
      if (r.hidden) {
        return `<div class="order-3d-file-row"><span>${escapeHtml(r.title)}</span><span class="enver-meta">Доступно внутрішнім ролям</span></div>`;
      }
      return `<a class="order-3d-file-row" href="${escapeHtml(r.href)}" download>
        <span>${escapeHtml(r.title)}</span>
        <span class="enver-meta">${escapeHtml(r.name)}</span>
      </a>`;
    })
    .join("");

  return `<aside class="order-3d-files-card card"><h4 class="enver-section-title">Файли</h4>${items}</aside>`;
}
