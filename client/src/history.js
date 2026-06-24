import { api } from "./api.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

const ENTITY_LABELS = {
  order: "Замовлення",
  position: "Позиція"
};

const ACTION_BADGE = {
  create: "green",
  update: "blue",
  delete: "red",
  stage_change: "yellow",
  auto_handoff: "purple"
};

export function formatHistoryTime(value) {
  if (!value) return "—";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
  return value;
}

export function renderChangesList(changes) {
  if (!changes?.length) {
    return '<span class="history-muted">—</span>';
  }
  return `<ul class="history-changes">
    ${changes
      .map(
        (c) => `
        <li>
          <span class="history-field">${escapeHtml(c.label)}</span>
          <span class="history-old">${escapeHtml(c.oldValue || "—")}</span>
          <span class="history-arrow">→</span>
          <span class="history-new">${escapeHtml(c.newValue || "—")}</span>
        </li>
      `
      )
      .join("")}
  </ul>`;
}

function historyRows(entries) {
  if (!entries.length) {
    return '<tr><td colspan="7" class="empty">Змін ще немає</td></tr>';
  }
  return entries
    .map((e) => {
      const badgeColor = ACTION_BADGE[e.action] || "gray";
      return `
        <tr>
          <td class="history-time">${escapeHtml(formatHistoryTime(e.createdAt))}</td>
          <td>${escapeHtml(e.userName || "—")}</td>
          <td>
            <span class="badge ${badgeColor}">${escapeHtml(e.actionLabel)}</span>
          </td>
          <td>${escapeHtml(ENTITY_LABELS[e.entityType] || e.entityType)} #${e.entityId}</td>
          <td class="left history-summary">${escapeHtml(e.summary)}</td>
          <td>${escapeHtml(e.orderNumber || "—")}</td>
          <td class="left">${renderChangesList(e.changes)}</td>
        </tr>
      `;
    })
    .join("");
}

export function filterHistoryEntries(entries, { search = "", entityType = "" } = {}) {
  return entries.filter((e) => {
    if (entityType && e.entityType !== entityType) return false;
    if (!search) return true;
    const hay = [
      e.summary,
      e.orderNumber,
      e.itemLabel,
      e.actionLabel,
      ENTITY_LABELS[e.entityType],
      ...e.changes.flatMap((c) => [c.label, c.oldValue, c.newValue])
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(search);
  });
}

export function historyTab() {
  const entityType = state.historyEntityFilter || "";
  const search = document.querySelector("#searchInput")?.value.toLowerCase().trim() || "";
  const entries = filterHistoryEntries(state.history || [], { search, entityType });

  return [
    '<div class="card">',
    '  <div class="card-header-row">',
    '    <div class="block-title">Історія змін</div>',
    '    <div class="history-toolbar">',
    '      <select id="historyEntityFilter" aria-label="Тип запису">',
    `        <option value=""${entityType === "" ? " selected" : ""}>Усі типи</option>`,
    `        <option value="order"${entityType === "order" ? " selected" : ""}>Замовлення</option>`,
    `        <option value="position"${entityType === "position" ? " selected" : ""}>Позиції</option>`,
    "      </select>",
    '      <button type="button" class="btn btn-sm" id="refreshHistoryBtn">Оновити</button>',
    "    </div>",
    "  </div>",
    '  <p class="note">Журнал створення, редагування, видалення та зміни етапів. Використовуйте пошук у шапці для фільтрації за текстом.</p>',
    '  <div class="table-wrap">',
    '    <table class="history-table">',
    "      <thead>",
    "        <tr>",
    "          <th>Час</th>",
    "          <th>Хто</th>",
    "          <th>Дія</th>",
    "          <th>Об'єкт</th>",
    '          <th class="left">Опис</th>',
    "          <th>Замовлення</th>",
    '          <th class="left">Деталі</th>',
    "        </tr>",
    "      </thead>",
    `      <tbody>${historyRows(entries)}</tbody>`,
    "    </table>",
    "  </div>",
    "</div>"
  ].join("\n");
}

export function renderDrawerHistory(entries) {
  if (!entries.length) {
    return '<p class="history-muted">Для цієї позиції змін ще не зафіксовано.</p>';
  }
  const items = entries
    .map(
      (e) => `
      <article class="history-timeline-item">
        <div class="history-timeline-head">
          <time>${escapeHtml(formatHistoryTime(e.createdAt))}</time>
          <span class="badge ${ACTION_BADGE[e.action] || "gray"}">${escapeHtml(e.actionLabel)}</span>
        </div>
        <p class="history-timeline-summary">${escapeHtml(e.summary)}</p>
        ${renderChangesList(e.changes)}
      </article>
    `
    )
    .join("");
  return `<div class="history-timeline">${items}</div>`;
}

export async function loadGlobalHistory() {
  state.history = await api.getHistory({ limit: 200 });
}

export async function loadPositionHistory(positionId) {
  return api.getHistory({ entityType: "position", entityId: positionId, limit: 50 });
}
