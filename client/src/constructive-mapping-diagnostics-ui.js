/** UI блок діагностики 3D-звʼязки пакета конструктива. */

import { escapeHtml } from "./utils.js";
import { MAPPING_STATUS_LABELS } from "./3d/enver-3d-types.js";

function normalizeDiagnostics(diagnostics) {
  if (!diagnostics) return null;
  return {
    totalParts: diagnostics.totalParts || 0,
    meshNodeCount: diagnostics.totalMeshes ?? diagnostics.meshNodeCount ?? 0,
    exactCount: diagnostics.exact ?? diagnostics.exactCount ?? 0,
    fallbackCount: diagnostics.fallback ?? diagnostics.fallbackCount ?? 0,
    ambiguousCount: diagnostics.ambiguous ?? diagnostics.ambiguousCount ?? 0,
    missingCount: diagnostics.missing ?? diagnostics.missingCount ?? 0,
    mappingQuality: diagnostics.quality ?? diagnostics.mappingQuality ?? 0,
    readinessStatus:
      diagnostics.readinessStatus ||
      (diagnostics.status === "ready"
        ? "Готово"
        : diagnostics.status === "needs_review"
          ? "Потрібна перевірка"
          : "Не готово"),
    unmappedParts: diagnostics.items?.length
      ? diagnostics.items.map((item) => ({
          partNo: item.partNo,
          partName: item.partName,
          material: "",
          dimensions: "",
          reason:
            item.mappingStatus === "ambiguous"
              ? MAPPING_STATUS_LABELS.ambiguous
              : item.mappingStatus === "missing"
                ? "mesh не знайдено"
                : item.reason || MAPPING_STATUS_LABELS.fallback,
          fallbackKey: item.candidateKeys?.[0] || "—",
          mappingStatus: item.mappingStatus
        }))
      : diagnostics.unmappedParts || []
  };
}

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
  const d = normalizeDiagnostics(diagnostics);
  if (!d) {
    return `<section class="cp-mapping-diagnostics" data-cp-mapping-diagnostics hidden></section>`;
  }

  const qualityPct = Math.round((d.mappingQuality || 0) * 100);
  const statusClass =
    d.readinessStatus === "Готово"
      ? "cp-mapping-diagnostics--ready"
      : d.readinessStatus === "Потрібна перевірка"
        ? "cp-mapping-diagnostics--review"
        : "cp-mapping-diagnostics--bad";

  return `
    <section class="cp-mapping-diagnostics ${statusClass}" data-cp-mapping-diagnostics>
      <h4 class="cp-mapping-diagnostics-title">3D звʼязка деталей</h4>
      <dl class="cp-mapping-diagnostics-stats">
        <div><dt>Деталей у пакеті</dt><dd>${d.totalParts || 0}</dd></div>
        <div><dt>Mesh у 3D</dt><dd>${d.meshNodeCount || 0}</dd></div>
        <div><dt>Точно звʼязано</dt><dd>${d.exactCount || 0}</dd></div>
        <div><dt>Резервна звʼязка</dt><dd>${d.fallbackCount || 0}</dd></div>
        <div><dt>Неоднозначно</dt><dd>${d.ambiguousCount || 0}</dd></div>
        <div><dt>Не звʼязано</dt><dd>${d.missingCount || 0}</dd></div>
        <div><dt>Якість звʼязки</dt><dd>${qualityPct}%</dd></div>
        <div><dt>Статус</dt><dd><strong>${escapeHtml(d.readinessStatus || "—")}</strong></dd></div>
      </dl>
      ${renderUnmappedRows(d.unmappedParts || [])}
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
