/** UI блок діагностики 3D-звʼязки пакета конструктива. */

import { escapeHtml } from "./utils.js";

function renderUnmappedRows(items = []) {
  if (!items.length) {
    return `<p class="enver-meta cp-mapping-diagnostics-empty">Усі деталі мають точну або резервну звʼязку.</p>`;
  }
  const rows = items
    .slice(0, 40)
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.partNo || "—")}</td>
        <td>${escapeHtml(p.partName || "—")}</td>
        <td>${escapeHtml(p.material || "—")}</td>
        <td>${escapeHtml(p.dimensions || "—")}</td>
        <td>${escapeHtml(p.reason || "—")}</td>
        <td><code>${escapeHtml(p.fallbackKey || "—")}</code></td>
      </tr>`
    )
    .join("");
  const more =
    items.length > 40
      ? `<p class="enver-meta">…ще ${items.length - 40} деталей без точної звʼязки</p>`
      : "";
  return `
    <div class="cp-mapping-diagnostics-table-wrap">
      <table class="cp-mapping-diagnostics-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Назва</th>
            <th>Матеріал</th>
            <th>Розміри</th>
            <th>Причина</th>
            <th>Fallback key</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${more}`;
}

export function renderModelMappingDiagnosticsBlock(diagnostics) {
  if (!diagnostics) {
    return `<section class="cp-mapping-diagnostics" data-cp-mapping-diagnostics hidden></section>`;
  }

  const qualityPct = Math.round((diagnostics.mappingQuality || 0) * 100);
  const statusClass =
    diagnostics.readinessStatus === "Готово"
      ? "cp-mapping-diagnostics--ready"
      : diagnostics.readinessStatus === "Потрібна перевірка"
        ? "cp-mapping-diagnostics--review"
        : "cp-mapping-diagnostics--bad";

  return `
    <section class="cp-mapping-diagnostics ${statusClass}" data-cp-mapping-diagnostics>
      <h4 class="cp-mapping-diagnostics-title">3D звʼязка деталей</h4>
      <dl class="cp-mapping-diagnostics-stats">
        <div><dt>Деталей у пакеті</dt><dd>${diagnostics.totalParts || 0}</dd></div>
        <div><dt>Mesh/node у 3D</dt><dd>${diagnostics.meshNodeCount || 0}</dd></div>
        <div><dt>Точно звʼязано</dt><dd>${diagnostics.exactCount || 0}</dd></div>
        <div><dt>Резервна звʼязка</dt><dd>${diagnostics.fallbackCount || 0}</dd></div>
        <div><dt>Не звʼязано</dt><dd>${diagnostics.missingCount || 0}</dd></div>
        <div><dt>Якість звʼязки</dt><dd>${qualityPct}%</dd></div>
        <div><dt>Статус</dt><dd><strong>${escapeHtml(diagnostics.readinessStatus || "—")}</strong></dd></div>
      </dl>
      ${
        diagnostics.ambiguousCount
          ? `<p class="cp-warning">Неоднозначних збігів: ${diagnostics.ambiguousCount}</p>`
          : ""
      }
      ${renderUnmappedRows(diagnostics.unmappedParts || [])}
      <button type="button" class="btn btn-sm" data-cp-mapping-recheck>Перевірити 3D-звʼязку</button>
    </section>`;
}

export function patchModelMappingDiagnosticsBlock(container, diagnostics) {
  if (!container) return;
  const existing = container.querySelector("[data-cp-mapping-diagnostics]");
  const html = renderModelMappingDiagnosticsBlock(diagnostics);
  if (existing) {
    existing.outerHTML = html;
  } else {
    container.insertAdjacentHTML("beforeend", html);
  }
}
