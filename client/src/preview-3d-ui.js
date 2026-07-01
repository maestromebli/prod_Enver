import { escapeHtml } from "./utils.js";
import {
  has3dPreviewFile,
  preview3dLayout,
  preview3dLayoutLabel,
  hasB3dSourceFile
} from "@enver/shared/production/constructive-package.js";
import { get3dUpgradeHintText } from "@enver/shared/production/resolve-3d-preview.js";
import {
  formatAssemblyMissingMessage,
  formatEnver3SyncMessage,
  formatEnver3dscanSyncMessage
} from "@enver/shared/production/preview-3d-meta.js";

export function renderPreview3dBadge(layout, label = "") {
  if (!layout) return "";
  const text = label || (layout === "assembly" ? "3D-збірка" : "Розкладка деталей");
  const tone = layout === "assembly" ? "preview-3d-badge--assembly" : "preview-3d-badge--flat";
  return `<span class="preview-3d-badge ${tone}">${escapeHtml(text)}</span>`;
}

export function renderPreview3dUpgradeBanner(hintText) {
  if (!hintText) return "";
  return `<div class="preview-3d-upgrade-banner" role="status">
    <span class="preview-3d-upgrade-banner__icon" aria-hidden="true">↑</span>
    <span>${escapeHtml(hintText)}</span>
  </div>`;
}

export function renderAssemblyMissingBanner(preview3d, totalPanels = 0) {
  if (!preview3d?.missingCodes?.length) return "";
  const msg = formatAssemblyMissingMessage({
    missingCodes: preview3d.missingCodes,
    totalPanels: totalPanels || preview3d.panelCount,
    assembledCount: preview3d.assembledCount
  });
  if (!msg) return "";
  return `<div class="preview-3d-missing-banner" role="status">${escapeHtml(msg)}</div>`;
}

export function renderEnver3SyncNote(preview3d) {
  const msgs = [
    formatEnver3SyncMessage(preview3d?.enver3Sync),
    formatEnver3dscanSyncMessage(preview3d?.enver3dscanSync)
  ].filter(Boolean);
  if (!msgs.length) return "";
  return msgs
    .map((msg) => `<p class="enver-meta preview-3d-enver3-note">${escapeHtml(msg)}</p>`)
    .join("");
}

/** Блок статусу 3D для пакета конструктива. */
export function renderPackage3dStatusBlock(detail) {
  if (!detail?.files?.length) return "";
  if (!has3dPreviewFile(detail) && !hasB3dSourceFile(detail)) return "";

  const layout =
    detail.preview3d?.layout || (has3dPreviewFile(detail) ? preview3dLayout(detail) : null);
  const badge = layout
    ? renderPreview3dBadge(
        layout,
        detail.preview3d?.isPartialAssembly ? "3D-збірка (частково)" : preview3dLayoutLabel(layout)
      )
    : `<span class="preview-3d-badge preview-3d-badge--pending">3D очікує файли</span>`;
  const hint = get3dUpgradeHintText({ layout, packageDetail: detail });
  const missing = renderAssemblyMissingBanner(detail.preview3d, detail.parts?.length);
  const enver3 = renderEnver3SyncNote(detail.preview3d);

  return `<div class="cp-3d-status">${badge}${missing}${enver3}${renderPreview3dUpgradeBanner(hint)}</div>`;
}

export function renderGiblabEnver3HookHelp() {
  const hook3dscan = `try {
  ENVER_AUTO_B3D_PATH = savedB3dPath;
  Execute(system.getFileName("enver-3dscan-export.js"));
} catch (e) {}`;

  const hookLegacy = `try {
  ENVER_AUTO_B3D_PATH = savedB3dPath;
  Execute(system.getFileName("enver-b3d-assembly-export.js"));
} catch (e) {}`;

  return `
    <details class="cp-enver3-hook">
      <summary class="cp-enver3-hook-summary">ENVER_3dscan після експорту .b3d з Базіс</summary>
      <ol class="cp-enver3-hook-steps enver-meta">
        <li>Скопіюйте <code>scripts/enver-3dscan-export.js</code> у папку скриптів Базіс (рекомендовано).</li>
        <li>У кінець <code>GibLabExport_Vx.x.js</code> додайте після збереження .b3d:</li>
      </ol>
      <pre class="cp-enver3-hook-code" tabindex="0">${escapeHtml(hook3dscan)}</pre>
      <p class="enver-meta">ENVER_3dscan зберігає збірку, отвори, кромку та коди операцій у хвіст .b3d (EN3DSC) + sidecar JSON. Завантажте <strong>.b3d + .project</strong> у пакет конструктива.</p>
      <details class="cp-enver3-hook-legacy">
        <summary class="enver-meta">Лише координати збірки (ENVER3, застарілий)</summary>
        <pre class="cp-enver3-hook-code" tabindex="0">${escapeHtml(hookLegacy)}</pre>
      </details>
    </details>`;
}
