import { api, getStoredToken } from "./api.js";
import { refreshAppData } from "./data-sync.js";
import { canManageConstructorDesk, canWorkConstructorDesk, isAdmin } from "./auth.js";
import { CONSTRUCTOR_DESK_TAB } from "./constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { runSave } from "./save-flow.js";
import { managerFileDownloadUrl } from "./position-manager-panel.js";
import {
  mergeConstructorAssignees,
  normalizePersonName,
  parseConstructorAssigneeValue
} from "@enver/shared/production/constructor-assignees.js";
import {
  bindPositionConstructivePanel,
  renderPositionConstructivePanel
} from "./position-constructive-panel.js";
import { loadConstructivePackageDetail } from "./constructive-package-ui.js";
import { loadCncJobsSummary, loadProcurementSummary } from "./constructive-pipeline-panel.js";
import { notifyUiChanged } from "./ui-persistence.js";

const LED_VOLTAGES = ["220", "24", "12"];
const CD_DISPLAY_LABELS = { cards: "Картки", list: "Список" };

function formatDateUa(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(value)
    );
  } catch {
    return String(value);
  }
}

export function constructorDeskFileUrl(positionId, fileId) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `/api/constructor-desk/positions/${positionId}/files/${fileId}${q}`;
}

function isImageMime(mime = "") {
  return String(mime).startsWith("image/");
}

function isPdfMime(mime = "", name = "") {
  return String(mime).includes("pdf") || String(name).toLowerCase().endsWith(".pdf");
}

function renderFilePreview(positionId, file) {
  if (file.externalUrl) {
    const url = escapeHtml(file.externalUrl);
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(file.externalUrl)) {
      return `<a href="${url}" target="_blank" rel="noopener"><img class="cd-preview-img" src="${url}" alt="" loading="lazy" /></a>`;
    }
    return `<a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">Відкрити посилання</a>`;
  }
  const href = managerFileDownloadUrl(positionId, file.id);
  if (isImageMime(file.mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.fileName)) {
    return `<a href="${href}" target="_blank" rel="noopener"><img class="cd-preview-img" src="${href}" alt="" loading="lazy" /></a>`;
  }
  if (isPdfMime(file.mime, file.fileName)) {
    return `<iframe class="cd-preview-pdf" src="${href}" title="${escapeHtml(file.fileName)}"></iframe>`;
  }
  return `<a class="btn btn-sm" href="${href}" target="_blank" rel="noopener" download>Завантажити ${escapeHtml(file.fileName || "файл")}</a>`;
}

function completionBadge(completion) {
  const pct = completion?.percent ?? 0;
  const cls = pct >= 100 ? "green" : pct >= 50 ? "blue" : "gray";
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function dueLabel(dueAt) {
  if (!dueAt) return "—";
  return formatDateUa(dueAt);
}

function orderKey(order) {
  return order.orderId != null ? `id:${order.orderId}` : `num:${order.orderNumber}`;
}

function orderAssignedConstructorsLabel(order) {
  const names = new Set();
  for (const position of order.positions || []) {
    const name = String(position.constructorUserName || position.constructor || "").trim();
    if (name) names.add(name);
  }
  if (!names.size) return "—";
  return [...names].sort((a, b) => a.localeCompare(b, "uk")).join(", ");
}

function findConstructorOrder(orderId) {
  const id = Number(orderId);
  return (state.constructorDesk.orders || []).find(
    (o) => o.orderId === id || String(o.orderNumber) === String(orderId)
  );
}

function constructorAssigneeKey(entry) {
  if (entry?.id != null) return `u:${entry.id}`;
  return `n:${String(entry?.name || "").trim()}`;
}

function selectedConstructorAssigneeValue(position, entry) {
  if (entry.id != null && position.constructorUserId === entry.id) {
    return constructorAssigneeKey(entry);
  }
  const assignedName = normalizePersonName(
    position.constructorUserName || position.constructor || ""
  );
  if (!position.constructorUserId && assignedName === normalizePersonName(entry.name)) {
    return constructorAssigneeKey(entry);
  }
  return null;
}

function constructorOptionsForPosition(position, constructors = []) {
  const list = [...constructors];
  if (!position.constructorUserId && String(position.constructor || "").trim()) {
    const name = position.constructor.trim();
    if (!list.some((u) => normalizePersonName(u.name) === normalizePersonName(name))) {
      list.unshift({ id: null, name });
    }
  } else if (
    position.constructorUserId &&
    !list.some((user) => user.id === position.constructorUserId)
  ) {
    list.unshift({
      id: position.constructorUserId,
      name: position.constructorUserName || position.constructor || `#${position.constructorUserId}`
    });
  }
  return list;
}

function renderConstructorOptions(position, constructors = []) {
  const options = constructorOptionsForPosition(position, constructors);
  if (!options.length) {
    return `<option value="" disabled>Додайте імена в довідник «Конструктори»</option>`;
  }
  return options
    .map((entry) => {
      const value = constructorAssigneeKey(entry);
      const selected = selectedConstructorAssigneeValue(position, entry) === value;
      const hint = entry.id == null ? " (без облікового запису)" : "";
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(entry.name)}${hint}</option>`;
    })
    .join("");
}

function constructorDirectoryNames() {
  return state.directories?.Конструктори || state.directories?.["Конструктори"] || [];
}

async function ensureConstructorDirectories() {
  if (constructorDirectoryNames().length) return;
  try {
    state.directories = await api.getDirectories();
  } catch {
    /* ігноруємо — спробуємо з API конструкторів */
  }
}

function resolveConstructorAssignees(apiList = []) {
  return mergeConstructorAssignees(apiList, constructorDirectoryNames());
}

function renderOrdersHero() {
  const isChief = canManageConstructorDesk();
  const f = state.constructorDesk.filter || "all";
  const filters = [
    ["all", "Усі"],
    ["unassigned", "Без конструктора"],
    ["mine", "Мої"],
    ["overdue", "Просрочені"],
    ["no_manager_files", "Без файлів менеджера"],
    ["no_manager_data", "Без даних менеджера"]
  ];
  const filterBtns = filters
    .map(
      ([key, label]) =>
        `<button type="button" class="enver-segmented-btn ${f === key ? "active" : ""}" data-cd-filter="${key}">${label}</button>`
    )
    .join("");
  return `
    <div class="cd-hero card">
      <div>
        <h2 class="block-title">Конструктори</h2>
        <p class="settings-hint">${
          isChief
            ? "Робочі позиції замовлень — ті самі, що в картці замовлення."
            : "Ваші призначені позиції."
        }</p>
      </div>
      <nav class="enver-segmented cd-filters">${filterBtns}</nav>
      ${isChief ? `<label class="checkbox-label"><input type="checkbox" id="cdOnlyMineToggle" ${state.constructorDesk.onlyMine ? "checked" : ""} /> Лише мої</label>` : ""}
    </div>`;
}

function filterDeskPositions(positions) {
  const f = state.constructorDesk.filter || "all";
  const now = Date.now();
  return positions.filter((p) => {
    if (f === "unassigned") return !p.constructorUserId && !String(p.constructor || "").trim();
    if (f === "mine") return true;
    if (f === "overdue") return p.constructorDueAt && new Date(p.constructorDueAt).getTime() < now;
    if (f === "no_manager_files") return !(p.managerFilesCount > 0);
    if (f === "no_manager_data") return !p.managerDataComplete;
    return true;
  });
}

function cdOrdersModeBarHtml() {
  const mode = state.constructorDesk.displayMode || "cards";
  const buttons = Object.entries(CD_DISPLAY_LABELS)
    .map(
      ([key, label]) =>
        `<button type="button" class="orders-mode-btn ${mode === key ? "active" : ""}" data-cd-orders-mode="${key}">${label}</button>`
    )
    .join("");
  return `<div class="orders-mode-bar card"><div class="orders-mode-switch">${buttons}</div></div>`;
}

function renderConstructorOrderCard(order) {
  const assigned = order.assignedCount || 0;
  const total = order.positionCount || 0;
  const pending = order.pendingCount || 0;
  const due = order.nearestDueAt ? dueLabel(order.nearestDueAt) : "—";
  const pendingBadge =
    pending > 0
      ? `<span class="badge orange cd-pending-badge">Очікує призначення: ${pending}</span>`
      : "";
  return `
    <article class="order-card cd-order-card enver-pressable" data-cd-order="${escapeHtml(orderKey(order))}">
      <h3 class="order-card-title">${escapeHtml(order.orderNumber)}</h3>
      <p class="order-card-meta order-card-object">${escapeHtml(order.object || "—")}</p>
      ${order.orderClient ? `<p class="order-card-meta enver-meta">${escapeHtml(order.orderClient)}</p>` : ""}
      ${pendingBadge}
      <p class="order-card-stage-line">
        <strong>${total}</strong> поз. · призначено <strong>${assigned}</strong> · готовність <strong>${order.maxCompletionPercent ?? 0}%</strong>
      </p>
      <p class="enver-meta">Найближчий дедлайн: ${due}</p>
      <button type="button" class="btn btn-sm btn-primary" data-cd-order="${escapeHtml(orderKey(order))}">Відкрити замовлення</button>
    </article>`;
}

function renderConstructorOrdersGrid(orders) {
  const cards = orders.map((order) => renderConstructorOrderCard(order)).join("");
  return `<div class="cd-orders-grid">
    ${cards || '<div class="card enver-empty-state"><p class="enver-meta">Немає замовлень, переданих конструкторам.</p></div>'}
  </div>`;
}

function renderConstructorOrdersListTable(orders) {
  const rows = orders.length
    ? orders
        .map((order) => {
          const assigned = order.assignedCount || 0;
          const total = order.positionCount || 0;
          const pending = order.pendingCount || 0;
          const due = order.nearestDueAt ? dueLabel(order.nearestDueAt) : "—";
          const pendingCell = pending > 0 ? `<span class="badge orange">${pending}</span>` : "—";
          const constructors = orderAssignedConstructorsLabel(order);

          return `<tr class="orders-list-row row-clickable cd-orders-list-row" data-cd-order="${escapeHtml(orderKey(order))}" tabindex="0">
            <td><strong>${escapeHtml(order.orderNumber)}</strong></td>
            <td class="left">${escapeHtml(order.orderClient || "—")}</td>
            <td class="left">${escapeHtml(order.object || "—")}</td>
            <td class="left">${escapeHtml(constructors)}</td>
            <td>${total}</td>
            <td>${assigned}</td>
            <td>${pendingCell}</td>
            <td>${order.maxCompletionPercent ?? 0}%</td>
            <td>${due}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9"><div class="enver-empty-state"><p class="enver-meta">Немає замовлень, переданих конструкторам.</p></div></td></tr>`;

  return `<div class="orders-list card cd-orders-list">
    <div class="table-wrap">
      <table class="orders-list-table cd-orders-list-table">
        <thead>
          <tr>
            <th>Номер</th>
            <th class="left">Клієнт</th>
            <th class="left">Об'єкт</th>
            <th class="left">Конструктори</th>
            <th>Поз.</th>
            <th>Призначено</th>
            <th>Очікує</th>
            <th>Готовність</th>
            <th>Дедлайн</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function renderConstructorOrdersList(orders) {
  const mode = state.constructorDesk.displayMode || "cards";
  const body =
    mode === "list"
      ? renderConstructorOrdersListTable(orders)
      : renderConstructorOrdersGrid(orders);

  return `
    <div class="constructor-desk">
      ${renderOrdersHero()}
      ${cdOrdersModeBarHtml()}
      ${body}
    </div>`;
}

function renderConstructorOrderDetail(order) {
  const isChief = canManageConstructorDesk();
  const positions = filterDeskPositions(order.positions || []);
  const rows = positions
    .map((p) => {
      const managerBadge = p.managerDataComplete
        ? `<span class="badge green">Дані ✓</span>`
        : `<span class="badge orange">Дані</span>`;
      const filesBadge =
        (p.managerFilesCount || 0) > 0
          ? `<span class="badge blue">${p.managerFilesCount} файл.</span>`
          : `<span class="badge gray">Без файлів</span>`;
      const assignCell = isChief
        ? `<select class="cd-assign-select" data-cd-assign-user="${p.id}">
            <option value="">— не призначено —</option>
            ${renderConstructorOptions(p, state.constructorDesk.constructors || [])}
          </select>
          <input type="datetime-local" class="cd-due-input" data-cd-due="${p.id}" value="${p.constructorDueAt ? p.constructorDueAt.slice(0, 16) : ""}" />
          <input type="number" class="cd-hours-input" data-cd-hours="${p.id}" min="0" step="0.5" placeholder="год" value="${p.constructorEstimatedHours ?? ""}" />
          <button type="button" class="btn btn-sm btn-ghost" data-cd-suggest-timing="${p.id}" title="ШІ оцінка">ШІ</button>
          <button type="button" class="btn btn-sm" data-cd-save-assign="${p.id}">Зберегти</button>`
        : `<span>${escapeHtml(p.constructorUserName || p.constructor || "—")}</span>
           <small class="enver-meta">${dueLabel(p.constructorDueAt)}</small>`;

      return `<tr>
        <td>${escapeHtml(p.item || "—")}<br><small class="enver-meta">${escapeHtml(p.itemType || "")}</small><br>${managerBadge} ${filesBadge}</td>
        <td class="cd-assign-cell">${assignCell}</td>
        <td>${completionBadge(p.completion)} ${p.requirements?.needsLed && p.completion?.ledOk === false ? "💡" : ""}</td>
        <td>${escapeHtml(p.currentStage || "—")}</td>
        <td><button type="button" class="btn btn-sm btn-primary" data-cd-open="${p.id}">Стіл конструктора</button></td>
      </tr>`;
    })
    .join("");

  return `
    <div class="constructor-desk">
      <div class="cd-ws-top">
        <button type="button" class="btn" id="cdBackToOrders">← Усі замовлення</button>
        <div class="cd-ws-title">
          <h2>${escapeHtml(order.orderNumber)}</h2>
          <p class="enver-meta">${escapeHtml(order.object || "")}${order.orderClient ? ` · ${escapeHtml(order.orderClient)}` : ""}</p>
        </div>
      </div>
      <div class="table-wrap card">
        <table class="cd-table">
          <thead>
            <tr>
              <th>Позиція</th>
              <th>${isChief ? "Призначення / дедлайн" : "Конструктор"}</th>
              <th>Готовність</th>
              <th>Етап</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty">Позицій немає</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function renderAssetBlock(positionId, kind, label, files, { linkValue = "", linkField = "" } = {}) {
  const kindFiles = files.filter((f) => f.kind === kind);
  return `
    <section class="card cd-asset-block" data-cd-asset-kind="${kind}">
      <h3>${escapeHtml(label)}</h3>
      ${linkField ? `<div class="form-field"><label>Посилання</label><input type="url" data-cd-link-field="${linkField}" value="${escapeHtml(linkValue)}" placeholder="https://…" /></div>` : ""}
      <div class="cd-upload-row">
        <label class="btn btn-sm cd-file-pick-btn">
          Обрати файл
          <input type="file" data-cd-file-input data-cd-kind="${kind}" data-cd-position="${positionId}" />
        </label>
        <span class="enver-meta" data-cd-file-name="${kind}">Файл не обрано</span>
        <input type="text" data-cd-file-label="${kind}" placeholder="Підпис (необов'язково)" />
        <button type="button" class="btn btn-sm btn-primary" data-cd-upload="${kind}" data-cd-position="${positionId}" disabled>Завантажити</button>
      </div>
      <div class="cd-file-previews">
        ${kindFiles
          .map(
            (f) => `<div class="cd-file-card">
              <div class="cd-file-card-head"><strong>${escapeHtml(f.label || f.fileName || "Файл")}</strong></div>
              ${renderFilePreview(positionId, f)}
            </div>`
          )
          .join("")}
      </div>
    </section>`;
}

function renderWorkspaceTabs(activeTab) {
  const tabs = [
    ["work", "Робоча сторона"],
    ["package", "Пакет конструктива"]
  ];
  const buttons = tabs
    .map(
      ([key, label]) =>
        `<button type="button" class="enver-segmented-btn ${activeTab === key ? "active" : ""}" data-cd-ws-tab="${key}">${label}</button>`
    )
    .join("");
  return `<nav class="enver-segmented cd-ws-tabs" role="tablist" aria-label="Розділи столу конструктора">${buttons}</nav>`;
}

function renderWorkspacePackage(position, downstream) {
  if (state.constructorDesk.packageLoading) {
    return `<div class="card cd-package-panel"><p class="enver-meta">Завантаження пакета…</p></div>`;
  }
  return `
    <div class="card cd-package-panel" data-cd-package-mount>
      ${renderPositionConstructivePanel(position, downstream, { editable: true })}
    </div>`;
}

function renderWorkspaceWork(detail, constructors) {
  const p = detail.position;
  const ws = p.workspace || {};
  const led = ws.ledLighting || {};
  const { needsTech = false, needsLed = false } = p.requirements || {};
  const isChief = canManageConstructorDesk();

  return `
      ${
        isChief
          ? `<div class="card cd-assign-card">
        <h3>Призначення</h3>
        <div class="cd-assign-grid">
          <select id="cdWsAssignUser">
            <option value="">— конструктор —</option>
            ${renderConstructorOptions(p, constructors)}
          </select>
          <input type="datetime-local" id="cdWsDue" value="${p.constructorDueAt ? p.constructorDueAt.slice(0, 16) : ""}" />
          <input type="number" id="cdWsHours" min="0" step="0.5" placeholder="години" value="${p.constructorEstimatedHours ?? ""}" />
          <button type="button" class="btn btn-sm btn-ghost" id="cdWsSuggestTiming">ШІ оцінка</button>
          <button type="button" class="btn btn-sm btn-primary" id="cdWsSaveAssign">Зберегти призначення</button>
        </div>
        <p class="settings-field-hint" id="cdTimingHint"></p>
      </div>`
          : ""
      }

      <div class="card cd-manager-input">
        <h3>Вхідні дані від менеджера</h3>
        <p class="enver-meta">Адреса, строки та файли з картки замовлення (тільки перегляд).</p>
        <div class="cd-manager-flags">
          <span class="enver-badge ${needsTech ? "enver-badge-warning" : ""}">${needsTech ? "Потрібна техніка" : "Техніка не потрібна"}</span>
          <span class="enver-badge ${needsLed ? "enver-badge-warning" : ""}">${needsLed ? "Потрібен LED" : "LED не потрібен"}</span>
        </div>
        <div class="cd-manager-files">
          ${
            (detail.managerFiles || [])
              .map(
                (f) =>
                  `<a class="btn btn-sm" href="${managerFileDownloadUrl(p.id, f.id)}" target="_blank" rel="noopener">${escapeHtml(f.fileName || f.kind)}</a>`
              )
              .join("") ||
            '<span class="enver-meta">Файлів менеджера ще немає — попросіть менеджера заповнити картку позиції.</span>'
          }
        </div>
      </div>

      ${
        needsLed
          ? `<div class="card cd-led-card">
        <h3>LED підсвітка <span class="badge red">обов'язково</span></h3>
        <div class="cd-led-grid">
          <div class="form-field">
            <label>Напруга на об'єкті</label>
            <select id="cdLedVoltage" required>
              <option value="">— оберіть —</option>
              ${LED_VOLTAGES.map((v) => `<option value="${v}" ${led.voltage === v ? "selected" : ""}>${v} В</option>`).join("")}
            </select>
          </div>
          <div class="form-field">
            <label>Колір підсвітки</label>
            <input id="cdLedColor" value="${escapeHtml(led.color || "")}" placeholder="напр. теплий білий 3000K" required />
          </div>
          <div class="form-field">
            <label>Профіль / стрічка</label>
            <input id="cdLedProfile" value="${escapeHtml(led.profile || "")}" placeholder="модель, розмір" />
          </div>
          <div class="form-field">
            <label>Контролер / димер</label>
            <input id="cdLedController" value="${escapeHtml(led.controller || "")}" />
          </div>
        </div>
        <div class="form-field">
          <label>Примітки LED</label>
          <textarea id="cdLedNotes" rows="2">${escapeHtml(led.notes || "")}</textarea>
        </div>
      </div>`
          : ""
      }

      ${needsTech ? renderAssetBlock(p.id, "tech", "Техніка", detail.files, { linkValue: ws.techLink || "", linkField: "techLink" }) : ""}

      ${renderAssetBlock(p.id, "measurements", "Заміри", detail.files)}
      ${renderAssetBlock(p.id, "manager_image", "Картинка від менеджера", detail.files)}

      <section class="card cd-custom-block">
        <h3>Додаткові файли та посилання</h3>
        <div id="cdCustomLinks">
          ${(ws.customLinks || [])
            .map(
              (link, i) => `<div class="cd-custom-row" data-cd-custom-idx="${i}">
              <input type="text" data-cd-custom-label value="${escapeHtml(link.label || "")}" placeholder="Назва" />
              <input type="url" data-cd-custom-url value="${escapeHtml(link.url || "")}" placeholder="https://…" />
              <button type="button" class="btn btn-sm btn-danger" data-cd-remove-custom="${i}">×</button>
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-sm" id="cdAddCustomLink">+ Посилання</button>
        ${renderAssetBlock(
          p.id,
          "custom",
          "Файли",
          detail.files.filter((f) => f.kind === "custom")
        )}
      </section>

      <section class="card cd-comments-block">
        <h3>Коментарі</h3>
        <ul class="cd-comments-list">
          ${
            detail.comments
              .map(
                (c) => `<li>
                <strong>${escapeHtml(c.authorName)}</strong>
                <small class="enver-meta">${escapeHtml(c.authorRole)} · ${formatDateUa(c.createdAt)}</small>
                <p>${escapeHtml(c.body)}</p>
              </li>`
              )
              .join("") || '<li class="enver-meta">Коментарів ще немає</li>'
          }
        </ul>
        <form id="cdCommentForm" class="cd-comment-form">
          <textarea id="cdCommentBody" rows="2" placeholder="Коментар для команди…" required></textarea>
          <button type="submit" class="btn btn-sm btn-primary">Додати</button>
        </form>
      </section>

      <div class="cd-ws-actions">
        <button type="button" class="btn btn-primary" id="cdSaveWorkspace">Зберегти робочу сторінку</button>
      </div>`;
}

function renderWorkspace(detail, constructors) {
  const p = detail.position;
  const wsTab = state.constructorDesk.workspaceTab || "work";
  const packageDetail = state.constructorDesk.packageDetail;
  const downstream = packageDetail
    ? {
        packageDetail,
        procurement: packageDetail.procurement ?? null,
        cncJobs: state.constructorDesk.packageCncJobs || []
      }
    : null;

  return `
    <div class="constructor-workspace">
      <div class="cd-ws-top">
        <button type="button" class="btn" id="cdBackToOrder">← До позицій замовлення</button>
        <div class="cd-ws-title">
          <h2>${escapeHtml(p.orderNumber)} · ${escapeHtml(p.item || "—")}</h2>
          <p class="enver-meta">${escapeHtml(p.object || "")} · ${escapeHtml(p.manager || "")}</p>
        </div>
        ${completionBadge(p.completion)}
      </div>

      ${renderWorkspaceTabs(wsTab)}

      ${wsTab === "package" ? renderWorkspacePackage(p, downstream) : renderWorkspaceWork(detail, constructors)}
    </div>`;
}

export function renderConstructorDeskTab() {
  if (!canWorkConstructorDesk()) {
    return `<div class="note">Немає доступу до столу конструктора.</div>`;
  }
  if (state.constructorDesk.loading) {
    return `<div class="cd-skeleton card" aria-busy="true">Завантаження…</div>`;
  }
  if (state.constructorDesk.error) {
    return `<div class="note" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">${escapeHtml(state.constructorDesk.error)}</div>`;
  }
  if (state.constructorDesk.selectedPositionId && state.constructorDesk.detail) {
    return renderWorkspace(state.constructorDesk.detail, state.constructorDesk.constructors || []);
  }
  if (state.constructorDesk.selectedOrderId != null) {
    const order = findConstructorOrder(state.constructorDesk.selectedOrderId);
    if (order) return renderConstructorOrderDetail(order);
  }
  return renderConstructorOrdersList(state.constructorDesk.orders || []);
}

export async function loadConstructorDesk({ silent = false } = {}) {
  if (!silent) state.constructorDesk.loading = true;
  try {
    await ensureConstructorDirectories();
    const shouldLoadConstructors =
      canManageConstructorDesk() || canWorkConstructorDesk() || isAdmin();
    const [orders, constructors] = await Promise.all([
      api.getConstructorDeskOrders(state.constructorDesk.onlyMine ? { mine: true } : {}),
      shouldLoadConstructors ? api.getConstructorDeskConstructors() : Promise.resolve([])
    ]);
    state.constructorDesk.orders = orders;
    state.constructorDesk.positions = orders.flatMap((o) => o.positions || []);
    state.constructorDesk.constructors = resolveConstructorAssignees(constructors);
    state.constructorDesk.error = "";
    state.constructorDesk.stale = false;
  } catch (err) {
    state.constructorDesk.error = err.message;
    state.constructorDesk.orders = [];
    state.constructorDesk.positions = [];
  } finally {
    if (!silent) state.constructorDesk.loading = false;
  }
}

export async function refreshConstructorWorkspace(
  positionId,
  { workspaceTab, reloadOrders = true, showLoading = false } = {}
) {
  const tab = workspaceTab ?? state.constructorDesk.workspaceTab ?? "work";
  if (showLoading) state.constructorDesk.loading = true;
  try {
    state.constructorDesk.workspaceTab = tab;
    const detail = await api.getConstructorDeskPosition(positionId);
    state.constructorDesk.detail = detail;
    state.constructorDesk.selectedPositionId = positionId;
    const orderId = detail?.position?.orderId;
    if (orderId != null) state.constructorDesk.selectedOrderId = orderId;

    if (tab === "package") {
      await loadConstructorDeskPackage(positionId);
    } else {
      state.constructorDesk.packageDetail = null;
      state.constructorDesk.packageCncJobs = [];
    }

    if (reloadOrders) {
      await loadConstructorDesk({ silent: true });
    }
    state.constructorDesk.error = "";
  } catch (err) {
    toastError(err.message);
    throw err;
  } finally {
    if (showLoading) state.constructorDesk.loading = false;
  }
}

export async function restoreConstructorDeskSession() {
  if (state.activeTab !== CONSTRUCTOR_DESK_TAB) return;
  const positionId = state.constructorDesk.selectedPositionId;
  if (positionId == null) return;

  try {
    await refreshConstructorWorkspace(positionId, {
      workspaceTab: state.constructorDesk.workspaceTab,
      showLoading: false,
      reloadOrders: false
    });
  } catch {
    state.constructorDesk.selectedPositionId = null;
    state.constructorDesk.detail = null;
  }
}

export function openConstructorOrder(orderKeyValue) {
  const raw = String(orderKeyValue || "");
  if (raw.startsWith("id:")) {
    state.constructorDesk.selectedOrderId = Number(raw.slice(3));
  } else if (raw.startsWith("num:")) {
    state.constructorDesk.selectedOrderId = raw.slice(4);
  } else {
    state.constructorDesk.selectedOrderId = Number(orderKeyValue) || orderKeyValue;
  }
  state.constructorDesk.selectedPositionId = null;
  state.constructorDesk.detail = null;
  notifyUiChanged();
}

export async function openConstructorDeskForAssignment({ orderId = null, positionId = null } = {}) {
  state.activeTab = CONSTRUCTOR_DESK_TAB;
  state.constructorDesk.detail = null;
  state.constructorDesk.selectedPositionId = null;
  state.constructorDesk.packageDetail = null;
  state.constructorDesk.workspaceTab = "work";
  notifyUiChanged();

  if (orderId != null) {
    state.constructorDesk.selectedOrderId = orderId;
  } else if (positionId != null) {
    const pos = state.positions.find((p) => p.id === positionId);
    state.constructorDesk.selectedOrderId = pos?.orderId ?? pos?.orderNumber ?? null;
  } else {
    state.constructorDesk.selectedOrderId = null;
  }

  await loadConstructorDesk();
  window.__enverRender?.();
}

export async function openConstructorWorkspace(positionId, { workspaceTab = "work" } = {}) {
  state.activeTab = CONSTRUCTOR_DESK_TAB;
  state.constructorDesk.selectedPositionId = positionId;
  state.constructorDesk.workspaceTab = workspaceTab;
  notifyUiChanged();
  state.constructorDesk.loading = true;
  window.__enverRender?.();
  try {
    await refreshConstructorWorkspace(positionId, {
      workspaceTab,
      showLoading: false,
      reloadOrders: true
    });
  } catch {
    /* toast у refreshConstructorWorkspace */
  } finally {
    state.constructorDesk.loading = false;
    window.__enverRender?.();
  }
}

async function loadConstructorDeskPackage(positionId) {
  state.constructorDesk.packageLoading = true;
  try {
    const [packageDetail, procurement, cncJobs] = await Promise.all([
      loadConstructivePackageDetail(positionId),
      loadProcurementSummary(positionId),
      loadCncJobsSummary(positionId)
    ]);
    state.constructorDesk.packageDetail = packageDetail
      ? { ...packageDetail, procurement: procurement || packageDetail.procurement }
      : null;
    state.constructorDesk.packageCncJobs = cncJobs || [];
  } finally {
    state.constructorDesk.packageLoading = false;
  }
}

let workspaceBindAbort = null;

export function bindConstructorDeskWorkspace(onChange = () => {}) {
  const root = document.querySelector(".constructor-workspace");
  if (!root) {
    workspaceBindAbort?.abort();
    workspaceBindAbort = null;
    return;
  }

  const positionId = state.constructorDesk.selectedPositionId;
  const position = state.constructorDesk.detail?.position;
  if (!positionId) return;

  workspaceBindAbort?.abort();
  workspaceBindAbort = new AbortController();
  const { signal } = workspaceBindAbort;

  root.addEventListener(
    "click",
    async (e) => {
      const tabBtn = e.target.closest("[data-cd-ws-tab]");
      if (tabBtn) {
        const nextTab = tabBtn.dataset.cdWsTab || "work";
        if (nextTab === state.constructorDesk.workspaceTab) return;
        state.constructorDesk.workspaceTab = nextTab;
        notifyUiChanged();
        if (nextTab === "package") {
          await loadConstructorDeskPackage(positionId);
        }
        onChange();
        return;
      }

      if (state.constructorDesk.workspaceTab !== "work") return;

      if (e.target.closest("#cdWsSuggestTiming")) {
        try {
          const s = await api.suggestConstructorTiming(positionId);
          const due = document.getElementById("cdWsDue");
          const hours = document.getElementById("cdWsHours");
          const hint = document.getElementById("cdTimingHint");
          if (due && s.dueAt) due.value = s.dueAt.slice(0, 16);
          if (hours && s.estimatedHours != null) hours.value = s.estimatedHours;
          if (hint) hint.textContent = s.rationale || "";
          toastSuccess("ШІ оцінку застосовано");
        } catch (err) {
          toastError(err.message);
        }
        return;
      }

      if (e.target.closest("#cdWsSaveAssign")) {
        const assignment = parseConstructorAssigneeValue(
          document.getElementById("cdWsAssignUser")?.value
        );
        try {
          const res = await api.assignConstructorDesk(positionId, {
            ...assignment,
            constructorDueAt: document.getElementById("cdWsDue")?.value
              ? new Date(document.getElementById("cdWsDue").value).toISOString()
              : null,
            constructorEstimatedHours: document.getElementById("cdWsHours")?.value
              ? Number(document.getElementById("cdWsHours").value)
              : null
          });
          toastSuccess(
            res?.orderStatusSync?.updated
              ? "Призначення збережено · замовлення переведено в «У конструктиві»"
              : "Призначення збережено"
          );
          await refreshConstructorWorkspace(positionId, { showLoading: false });
          void loadConstructorDesk({ silent: true }).then(() => onChange());
          onChange();
        } catch (err) {
          toastError(err.message);
        }
        return;
      }

      if (e.target.closest("#cdAddCustomLink")) {
        const ws = state.constructorDesk.detail?.position?.workspace || {};
        ws.customLinks = [...(ws.customLinks || []), { label: "", url: "" }];
        state.constructorDesk.detail.position.workspace = ws;
        onChange();
        return;
      }

      const removeCustom = e.target.closest("[data-cd-remove-custom]");
      if (removeCustom) {
        const idx = Number(removeCustom.dataset.cdRemoveCustom);
        const ws = state.constructorDesk.detail?.position?.workspace || {};
        ws.customLinks = (ws.customLinks || []).filter((_, i) => i !== idx);
        state.constructorDesk.detail.position.workspace = ws;
        onChange();
        return;
      }

      if (e.target.closest("#cdSaveWorkspace")) {
        const workspace = readWorkspaceFromDom();
        const btn = e.target.closest("#cdSaveWorkspace");
        await runSave("Робоча сторінка конструктора", {
          submitEl: btn,
          saveFn: () => api.saveConstructorDeskWorkspace(positionId, { workspace, strict: true }),
          successMessage: "Збережено",
          onSuccess: async () => {
            await refreshConstructorWorkspace(positionId, { showLoading: false });
            onChange();
            void loadConstructorDesk({ silent: true }).then(() => onChange());
          }
        }).catch(() => {});
      }
    },
    { signal }
  );

  root.addEventListener(
    "submit",
    async (e) => {
      if (e.target?.id !== "cdCommentForm") return;
      e.preventDefault();
      const body = document.getElementById("cdCommentBody")?.value?.trim();
      if (!body) return;
      try {
        state.constructorDesk.detail = await api.addConstructorDeskComment(positionId, { body });
        toastSuccess("Коментар додано");
        onChange();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );

  if (state.constructorDesk.workspaceTab !== "package") return;

  const mount = root.querySelector("[data-cd-package-mount]");
  if (!mount || !position) return;

  bindPositionConstructivePanel(mount, position, {
    editable: true,
    downstream: {
      packageDetail: state.constructorDesk.packageDetail,
      procurement: state.constructorDesk.packageDetail?.procurement,
      cncJobs: state.constructorDesk.packageCncJobs
    },
    onRefresh: async () => {
      await loadConstructorDeskPackage(positionId);
      await refreshAppData({ syncViews: true });
      onChange();
    }
  });
}

function readWorkspaceFromDom() {
  const customLinks = [...document.querySelectorAll(".cd-custom-row")]
    .map((row) => ({
      label: row.querySelector("[data-cd-custom-label]")?.value?.trim() || "",
      url: row.querySelector("[data-cd-custom-url]")?.value?.trim() || ""
    }))
    .filter((l) => l.label || l.url);

  const requirements = state.constructorDesk.detail?.position?.requirements || {};
  const workspace = {
    isKitchen: Boolean(state.constructorDesk.detail?.position?.workspace?.isKitchen),
    customLinks
  };

  if (requirements.needsTech) {
    workspace.techLink =
      document.querySelector('[data-cd-link-field="techLink"]')?.value?.trim() || "";
  }

  if (requirements.needsLed) {
    workspace.ledLighting = {
      voltage: document.getElementById("cdLedVoltage")?.value || "",
      color: document.getElementById("cdLedColor")?.value?.trim() || "",
      profile: document.getElementById("cdLedProfile")?.value?.trim() || "",
      controller: document.getElementById("cdLedController")?.value?.trim() || "",
      notes: document.getElementById("cdLedNotes")?.value?.trim() || ""
    };
  }

  return workspace;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function handleDeskPickFile(pickFileBtn) {
  const kind = pickFileBtn.dataset.cdPickFile;
  if (!kind) return;
  const filePositionId = Number(pickFileBtn.dataset.cdPosition);
  if (!filePositionId) return;
  const block = pickFileBtn.closest(".cd-asset-block");
  const nameEl = block?.querySelector(`[data-cd-file-name="${kind}"]`);
  void pickLocalFile().then((file) => {
    if (!file || !(file instanceof File)) return;
    pendingDeskFiles.set(deskFileKey(filePositionId, kind), file);
    if (nameEl) nameEl.textContent = file.name;
  });
}

async function handleDeskUpload(uploadBtn, onChange) {
  const block = uploadBtn.closest(".cd-asset-block");
  const kind = uploadBtn.dataset.cdUpload;
  const filePositionId = Number(uploadBtn.dataset.cdPosition);
  if (!kind || !filePositionId) return;
  const labelInput = block?.querySelector(`[data-cd-file-label="${kind}"]`);
  const nameEl = block?.querySelector(`[data-cd-file-name="${kind}"]`);
  let file = pendingDeskFiles.get(deskFileKey(filePositionId, kind));
  if (!file) {
    toastError("Спочатку оберіть файл");
    void pickLocalFile().then((picked) => {
      if (!picked || !(picked instanceof File)) return;
      pendingDeskFiles.set(deskFileKey(filePositionId, kind), picked);
      if (nameEl) nameEl.textContent = picked.name;
    });
    return;
  }
  try {
    const dataBase64 = await fileToBase64(file);
    await api.uploadConstructorDeskFile(filePositionId, {
      kind,
      label: labelInput?.value?.trim() || file.name,
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      dataBase64
    });
    toastSuccess("Файл завантажено");
    pendingDeskFiles.delete(deskFileKey(filePositionId, kind));
    await refreshConstructorWorkspace(filePositionId, { showLoading: false, reloadOrders: false });
    onChange();
    void loadConstructorDesk({ silent: true }).then(() => onChange());
  } catch (err) {
    toastError(err.message);
  }
}

let actionsBound = false;

async function syncDeskWithOrders(onChange) {
  await refreshAppData({ syncViews: true });
  onChange?.();
}

export function bindConstructorDeskActions(onChange = () => {}) {
  if (actionsBound) return;
  actionsBound = true;

  document.addEventListener("click", async (e) => {
    const pickFileBtn = e.target.closest("[data-cd-pick-file]");
    if (pickFileBtn?.closest(".constructor-workspace")) {
      handleDeskPickFile(pickFileBtn);
      return;
    }

    const uploadBtn = e.target.closest("[data-cd-upload]");
    if (uploadBtn?.closest(".constructor-workspace")) {
      await handleDeskUpload(uploadBtn, onChange);
      return;
    }

    if (e.target.closest(".constructor-workspace")) return;

    const modeBtn = e.target.closest("[data-cd-orders-mode]");
    if (modeBtn) {
      state.constructorDesk.displayMode = modeBtn.dataset.cdOrdersMode || "cards";
      notifyUiChanged();
      onChange();
      return;
    }

    const orderBtn = e.target.closest("[data-cd-order]");
    if (orderBtn) {
      openConstructorOrder(orderBtn.dataset.cdOrder);
      onChange();
      return;
    }

    const openBtn = e.target.closest("[data-cd-open]");
    if (openBtn) {
      await openConstructorWorkspace(Number(openBtn.dataset.cdOpen));
      onChange();
      return;
    }

    if (e.target.closest("#cdBackToOrders")) {
      state.constructorDesk.selectedOrderId = null;
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      notifyUiChanged();
      onChange();
      return;
    }

    if (e.target.closest("#cdBackToOrder")) {
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      state.constructorDesk.packageDetail = null;
      state.constructorDesk.workspaceTab = "work";
      notifyUiChanged();
      onChange();
      return;
    }

    if (e.target.closest("#cdOnlyMineToggle")) {
      state.constructorDesk.onlyMine = e.target.checked;
      state.constructorDesk.selectedOrderId = null;
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      notifyUiChanged();
      await loadConstructorDesk();
      onChange();
      return;
    }

    const filterBtn = e.target.closest("[data-cd-filter]");
    if (filterBtn) {
      state.constructorDesk.filter = filterBtn.dataset.cdFilter || "all";
      onChange();
      return;
    }

    const saveAssignBtn = e.target.closest("[data-cd-save-assign]");
    if (saveAssignBtn) {
      const id = Number(saveAssignBtn.dataset.cdSaveAssign);
      const assignValue = document.querySelector(`[data-cd-assign-user="${id}"]`)?.value;
      const due = document.querySelector(`[data-cd-due="${id}"]`)?.value;
      const hours = document.querySelector(`[data-cd-hours="${id}"]`)?.value;
      const assignment = parseConstructorAssigneeValue(assignValue);
      try {
        const res = await api.assignConstructorDesk(id, {
          ...assignment,
          constructorDueAt: due ? new Date(due).toISOString() : null,
          constructorEstimatedHours: hours ? Number(hours) : null
        });
        toastSuccess(
          res?.orderStatusSync?.updated
            ? "Призначення збережено · замовлення переведено в «У конструктиві»"
            : "Призначення збережено"
        );
        await syncDeskWithOrders(onChange);
      } catch (err) {
        toastError(err.message);
      }
      return;
    }

    const suggestBtn = e.target.closest("[data-cd-suggest-timing]");
    if (suggestBtn) {
      const id = Number(suggestBtn.dataset.cdSuggestTiming);
      try {
        const s = await api.suggestConstructorTiming(id);
        const dueInput = document.querySelector(`[data-cd-due="${id}"]`);
        const hoursInput = document.querySelector(`[data-cd-hours="${id}"]`);
        if (dueInput && s.dueAt) dueInput.value = s.dueAt.slice(0, 16);
        if (hoursInput && s.estimatedHours != null) hoursInput.value = s.estimatedHours;
        toastSuccess(s.rationale || "Оцінку застосовано");
      } catch (err) {
        toastError(err.message);
      }
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    const row = e.target.closest(".cd-orders-list-row[data-cd-order]");
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openConstructorOrder(row.dataset.cdOrder);
      onChange();
    }
  });
}
