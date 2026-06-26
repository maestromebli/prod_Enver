import { formatInstallPeriod } from "./install-utils.js";
import { buildVisiblePositionRows } from "./position-tree.js";
import { positionActionButtons } from "./positions.js";
import { renderHealthBadge, resolvePositionGodmode } from "./godmode-ui.js";
import { resolveObjectNameFromOrders } from "@enver/shared/production/object-display.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { state } from "./state.js";
import { badge, escapeHtml, overdue, progressBar } from "./utils.js";

function objectLabel(position) {
  return resolveObjectNameFromOrders(position, state.orders) || "—";
}

function progress(value) {
  return progressBar(value);
}

function treeControls(row) {
  const { position: p, childCount = 0, isSub } = row;
  if (isSub) {
    return `<span class="tree-indent" aria-hidden="true"></span>`;
  }

  const expanded = row.expanded;
  const toggle =
    childCount > 0
      ? `<button type="button" class="btn-tree" data-toggle-position="${p.id}" title="${expanded ? "Згорнути підпозиції" : "Показати підпозиції"}">${expanded ? "▼" : "▶"}</button>`
      : `<span class="btn-tree-placeholder" aria-hidden="true"></span>`;

  const addSub = `<button type="button" class="btn btn-ghost btn-sm btn-add-sub" data-add-sub-position="${p.id}" title="Додати підпозицію">+</button>`;

  return `<span class="tree-controls">${toggle}${addSub}</span>`;
}

function positionRowCells(p, row, showActions) {
  const isSub = row.isSub;
  const itemCell = isSub
    ? `<span class="sub-label">↳ ${escapeHtml(p.item)}</span>`
    : `<strong>${escapeHtml(p.item)}</strong>`;

  return `
    <td class="col-opt-id">${p.id}</td>
    <td>${isSub ? "—" : escapeHtml(p.orderNumber)}</td>
    <td class="col-opt-object">${isSub ? "—" : escapeHtml(objectLabel(p))}</td>
    <td class="left col-item" title="${escapeHtml(p.item)}">${treeControls(row)}${itemCell}</td>
    <td class="col-opt-type">${escapeHtml(p.itemType || "—")}</td>
    <td class="col-opt-manager">${escapeHtml(p.manager || "—")}</td>
    <td class="col-opt-constructor">${escapeHtml(p.constructor || "—")}</td>
    <td>${badge(p.cuttingStatus)}</td>
    <td class="col-opt-edging">${badge(p.edgingStatus)}</td>
    <td class="col-opt-drilling">${badge(p.drillingStatus)}</td>
    <td>${badge(p.assemblyStatus)}</td>
    <td class="col-opt-ready">${escapeHtml(p.readyDate || "—")}</td>
    <td class="col-opt-install-date">${escapeHtml(formatInstallPeriod(p))}</td>
    <td>${escapeHtml(p.installResponsible || "—")}</td>
    <td>${badge(p.positionStatus)}</td>
    <td>${progress(p.progress)}</td>
    <td class="col-opt-overdue">${overdue(p.overdueDays)}</td>
    <td class="left col-opt-problem">${escapeHtml(p.problem || "—")}</td>
    <td class="left col-opt-note">${escapeHtml(p.note || "—")}</td>
    ${showActions ? `<td>${positionActionButtons(p.id, isSub)}</td>` : ""}
  `;
}

export function renderPositionTableBody(
  data,
  allPositions,
  expandedIds,
  showActions = false,
  newTaskIds = new Set()
) {
  const rows = buildVisiblePositionRows(allPositions, data, expandedIds).map((row) => {
    const expanded = expandedIds.has(row.position.id);
    return {
      ...row,
      expanded
    };
  });

  if (!rows.length) {
    return null;
  }

  return rows
    .map((row) => {
      const { position: p, isSub, childCount, expanded } = row;
      const rowClass = [
        "row-clickable",
        isSub ? "row-sub-position" : "row-position-parent",
        newTaskIds.has(Number(p.id)) ? "row-position-fresh" : ""
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <tr class="${rowClass}" data-edit-position="${p.id}">
          ${positionRowCells(p, { position: p, isSub, childCount, expanded }, showActions)}
        </tr>
      `;
    })
    .join("");
}

function positionCard(row, showActions) {
  const { position: p, isSub, childCount, expanded } = row;
  const stage = stageLabel(p.currentStage || "constructor");
  const fresh = row.fresh ? "position-card--fresh" : "";
  const sub = isSub ? "position-card--sub" : "";

  const toggle =
    !isSub && childCount > 0
      ? `<button type="button" class="position-card-toggle btn-tree" data-toggle-position="${p.id}" aria-label="Підпозиції">${expanded ? "▾" : "▸"}</button>`
      : "";

  const addSub = !isSub
    ? `<button type="button" class="btn btn-sm btn-add-sub" data-add-sub-position="${p.id}" title="Підпозиція">+</button>`
    : "";

  const problem = p.problem?.trim()
    ? `<span class="position-card-warn" title="Є проблема">Проблема</span>`
    : "";

  const overdueHtml =
    (p.overdueDays ?? 0) > 0
      ? `<span class="position-card-overdue">+${p.overdueDays} д</span>`
      : "";

  const gm = !isSub ? resolvePositionGodmode(p) : null;
  const healthBadge = gm ? renderHealthBadge(gm.health) : "";

  return `
    <article class="position-card enver-card ${sub} ${fresh}" data-edit-position="${p.id}" tabindex="0">
      <div class="position-card-head">
        <div class="position-card-title-row">
          ${toggle}
          <h3 class="position-card-title">${isSub ? "↳ " : ""}${escapeHtml(p.item || "—")}</h3>
          ${healthBadge}
          ${problem}
        </div>
        <p class="position-card-meta">${escapeHtml(p.orderNumber || "—")} · ${escapeHtml(objectLabel(p))}</p>
      </div>
      <div class="position-card-body">
        ${progressBar(p.progress)}
        <div class="position-card-tags">
          ${badge(p.positionStatus)}
          <span class="stage-pill stage-pill--compact">${escapeHtml(stage)}</span>
          ${overdueHtml}
        </div>
      </div>
      <div class="position-card-foot">
        ${showActions ? positionActionButtons(p.id, isSub) : ""}
        ${addSub}
        <button type="button" class="btn btn-sm position-card-open" data-edit-position="${p.id}">Відкрити</button>
      </div>
    </article>`;
}

/** Картковий режим для мобільних (таблиця ховається в CSS). */
export function renderPositionCards(
  data,
  allPositions,
  expandedIds,
  showActions = false,
  newTaskIds = new Set()
) {
  const rows = buildVisiblePositionRows(allPositions, data, expandedIds).map((row) => ({
    ...row,
    expanded: expandedIds.has(row.position.id),
    fresh: newTaskIds.has(Number(row.position.id))
  }));

  if (!rows.length) {
    return `<div class="enver-empty-state positions-cards-empty">
      <span class="enver-empty-state-icon" aria-hidden="true">📦</span>
      <h3 class="enver-empty-state-title">Немає позицій</h3>
      <p class="enver-empty-state-text">Змініть фільтри або додайте нову позицію до замовлення.</p>
    </div>`;
  }

  return `<div class="positions-cards-grid">${rows.map((r) => positionCard(r, showActions)).join("")}</div>`;
}
