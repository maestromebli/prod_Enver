import { buildVisiblePositionRows } from "./position-tree.js";
import { positionActionButtons } from "./positions.js";
import { badge, escapeHtml, overdue, progressBar } from "./utils.js";

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
    <td class="col-opt-object">${isSub ? "—" : escapeHtml(p.object)}</td>
    <td class="left col-item" title="${escapeHtml(p.item)}">${treeControls(row)}${itemCell}</td>
    <td class="col-opt-type">${escapeHtml(p.itemType || "—")}</td>
    <td class="col-opt-manager">${escapeHtml(p.manager || "—")}</td>
    <td class="col-opt-constructor">${escapeHtml(p.constructor || "—")}</td>
    <td>${badge(p.cuttingStatus)}</td>
    <td class="col-opt-edging">${badge(p.edgingStatus)}</td>
    <td class="col-opt-drilling">${badge(p.drillingStatus)}</td>
    <td>${badge(p.assemblyStatus)}</td>
    <td class="col-opt-ready">${escapeHtml(p.readyDate || "—")}</td>
    <td class="col-opt-install-date">${escapeHtml(p.installDate || "—")}</td>
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
