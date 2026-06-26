import { renderQrSvg } from "./barcode.js";
import { formatPartDimensionsMm } from "../../../shared/production/constructive-package.js";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function renderPartLabelsHtml({ position, parts = [] }) {
  const labels = await Promise.all(
    parts.map(async (p) => {
      const qr = await renderQrSvg(p.barcodeValue || p.qrValue, { width: 120 });
      return `
      <div class="label">
        <div class="label-order">${escapeHtml(position.order_number)} · ${escapeHtml(position.item)}</div>
        <div class="label-block">${escapeHtml(p.blockCode || "—")} · №${escapeHtml(p.partNo)}</div>
        <div class="label-name">${escapeHtml(p.partName)}</div>
        <div class="label-size">${escapeHtml(formatPartDimensionsMm(p))}</div>
        <div class="label-material">${escapeHtml(p.material)}</div>
        ${p.edgeCode ? `<div class="label-edge">${escapeHtml(p.edgeCode)}</div>` : ""}
        <div class="label-qr">${qr}</div>
        <div class="label-code">${escapeHtml(p.barcodeValue)}</div>
      </div>`;
    })
  );

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8"/>
  <title>Етикетки деталей — ${escapeHtml(position.order_number)}</title>
  <style>
    @page { size: A4; margin: 8mm; }
    body { font-family: system-ui, sans-serif; margin: 0; }
    .labels { display: flex; flex-wrap: wrap; gap: 6mm; }
    .label {
      width: 62mm; min-height: 38mm; border: 1px solid #333; padding: 3mm;
      page-break-inside: avoid; box-sizing: border-box;
    }
    .label-order { font-weight: 700; font-size: 11pt; }
    .label-block { font-size: 10pt; }
    .label-name { font-size: 9pt; margin: 1mm 0; }
    .label-size, .label-material, .label-edge { font-size: 8pt; color: #333; }
    .label-qr svg { width: 28mm; height: 28mm; display: block; margin: 2mm auto; }
    .label-code { font-family: monospace; font-size: 7pt; text-align: center; word-break: break-all; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <p class="no-print"><button onclick="window.print()">Друк</button></p>
  <div class="labels">${labels.join("")}</div>
</body>
</html>`;
}
