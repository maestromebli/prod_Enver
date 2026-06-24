import { api, getStoredToken } from "./api.js";
import { canManageConstructorDesk, canWorkConstructorDesk } from "./auth.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { runSave } from "./save-flow.js";

const LED_VOLTAGES = ["220", "24", "12"];

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
  const href = constructorDeskFileUrl(positionId, file.id);
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

function findConstructorOrder(orderId) {
  const id = Number(orderId);
  return (state.constructorDesk.orders || []).find(
    (o) => o.orderId === id || String(o.orderNumber) === String(orderId)
  );
}

function renderOrdersHero() {
  const isChief = canManageConstructorDesk();
  return `
    <div class="cd-hero card">
      <div>
        <h2 class="block-title">Замовлення у конструкторах</h2>
        <p class="settings-hint">${
          isChief
            ? "Позиції на етапі конструктиву або з призначеним конструктором."
            : "Ваші призначені замовлення та позиції."
        }</p>
      </div>
      ${isChief ? `<label class="checkbox-label"><input type="checkbox" id="cdOnlyMineToggle" ${state.constructorDesk.onlyMine ? "checked" : ""} /> Лише мої</label>` : ""}
    </div>`;
}

function renderConstructorOrdersList(orders) {
  const cards = orders
    .map((order) => {
      const assigned = order.assignedCount || 0;
      const total = order.positionCount || 0;
      const due = order.nearestDueAt ? dueLabel(order.nearestDueAt) : "—";
      return `
        <article class="order-card cd-order-card enver-pressable" data-cd-order="${escapeHtml(orderKey(order))}">
          <h3 class="order-card-title">${escapeHtml(order.orderNumber)}</h3>
          <p class="order-card-meta order-card-object">${escapeHtml(order.object || "—")}</p>
          ${order.orderClient ? `<p class="order-card-meta enver-meta">${escapeHtml(order.orderClient)}</p>` : ""}
          <p class="order-card-stage-line">
            <strong>${total}</strong> поз. · призначено <strong>${assigned}</strong> · готовність <strong>${order.maxCompletionPercent ?? 0}%</strong>
          </p>
          <p class="enver-meta">Найближчий дедлайн: ${due}</p>
          <button type="button" class="btn btn-sm btn-primary" data-cd-order="${escapeHtml(orderKey(order))}">Відкрити замовлення</button>
        </article>`;
    })
    .join("");

  return `
    <div class="constructor-desk">
      ${renderOrdersHero()}
      <div class="cd-orders-grid">
        ${cards || '<div class="card enver-empty-state"><p class="enver-meta">Немає замовлень, переданих конструкторам.</p></div>'}
      </div>
    </div>`;
}

function renderConstructorOrderDetail(order) {
  const isChief = canManageConstructorDesk();
  const positions = order.positions || [];
  const rows = positions
    .map((p) => {
      const assignCell = isChief
        ? `<select class="cd-assign-select" data-cd-assign-user="${p.id}">
            <option value="">— не призначено —</option>
            ${(state.constructorDesk.constructors || [])
              .map(
                (u) =>
                  `<option value="${u.id}" ${p.constructorUserId === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`
              )
              .join("")}
          </select>
          <input type="datetime-local" class="cd-due-input" data-cd-due="${p.id}" value="${p.constructorDueAt ? p.constructorDueAt.slice(0, 16) : ""}" />
          <input type="number" class="cd-hours-input" data-cd-hours="${p.id}" min="0" step="0.5" placeholder="год" value="${p.constructorEstimatedHours ?? ""}" />
          <button type="button" class="btn btn-sm btn-ghost" data-cd-suggest-timing="${p.id}" title="ШІ оцінка">ШІ</button>
          <button type="button" class="btn btn-sm" data-cd-save-assign="${p.id}">Зберегти</button>`
        : `<span>${escapeHtml(p.constructorUserName || p.constructor || "—")}</span>
           <small class="enver-meta">${dueLabel(p.constructorDueAt)}</small>`;

      return `<tr>
        <td>${escapeHtml(p.item || "—")}<br><small class="enver-meta">${escapeHtml(p.itemType || "")}</small></td>
        <td class="cd-assign-cell">${assignCell}</td>
        <td>${completionBadge(p.completion)} ${p.completion?.ledOk ? "💡" : ""}</td>
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
    <section class="cd-asset-block" data-cd-asset-kind="${kind}">
      <h3>${escapeHtml(label)}</h3>
      ${linkField ? `<div class="form-field"><label>Посилання</label><input type="url" data-cd-link-field="${linkField}" value="${escapeHtml(linkValue)}" placeholder="https://…" /></div>` : ""}
      <div class="cd-upload-row">
        <input type="file" data-cd-file-kind="${kind}" data-cd-position="${positionId}" />
        <input type="text" data-cd-file-label="${kind}" placeholder="Підпис (необов'язково)" />
        <button type="button" class="btn btn-sm" data-cd-upload="${kind}" data-cd-position="${positionId}">Завантажити</button>
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

function renderWorkspace(detail, constructors) {
  const p = detail.position;
  const ws = p.workspace || {};
  const led = ws.ledLighting || {};
  const isKitchen = ws.isKitchen;
  const isChief = canManageConstructorDesk();

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

      ${
        isChief
          ? `<div class="card cd-assign-card">
        <h3>Призначення</h3>
        <div class="cd-assign-grid">
          <select id="cdWsAssignUser">
            <option value="">— конструктор —</option>
            ${constructors.map((u) => `<option value="${u.id}" ${p.constructorUserId === u.id ? "selected" : ""}>${escapeHtml(u.name)}</option>`).join("")}
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

      <div class="card cd-led-card">
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
      </div>

      ${isKitchen ? renderAssetBlock(p.id, "tech", "Техніка (кухня)", detail.files, { linkValue: ws.techLink || "", linkField: "techLink" }) : ""}

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
      </div>
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

export async function loadConstructorDesk() {
  state.constructorDesk.loading = true;
  try {
    const [orders, constructors] = await Promise.all([
      api.getConstructorDeskOrders(state.constructorDesk.onlyMine ? { mine: true } : {}),
      canManageConstructorDesk() ? api.getConstructorDeskConstructors() : Promise.resolve([])
    ]);
    state.constructorDesk.orders = orders;
    state.constructorDesk.positions = orders.flatMap((o) => o.positions || []);
    state.constructorDesk.constructors = constructors;
    state.constructorDesk.error = "";
  } catch (err) {
    state.constructorDesk.error = err.message;
    state.constructorDesk.orders = [];
    state.constructorDesk.positions = [];
  } finally {
    state.constructorDesk.loading = false;
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
}

export async function openConstructorWorkspace(positionId) {
  state.constructorDesk.loading = true;
  try {
    state.constructorDesk.detail = await api.getConstructorDeskPosition(positionId);
    state.constructorDesk.selectedPositionId = positionId;
    const orderId = state.constructorDesk.detail?.position?.orderId;
    if (orderId != null) state.constructorDesk.selectedOrderId = orderId;
  } catch (err) {
    toastError(err.message);
  } finally {
    state.constructorDesk.loading = false;
  }
}

function readWorkspaceFromDom() {
  const customLinks = [...document.querySelectorAll(".cd-custom-row")]
    .map((row) => ({
      label: row.querySelector("[data-cd-custom-label]")?.value?.trim() || "",
      url: row.querySelector("[data-cd-custom-url]")?.value?.trim() || ""
    }))
    .filter((l) => l.label || l.url);

  return {
    isKitchen: Boolean(state.constructorDesk.detail?.position?.workspace?.isKitchen),
    techLink: document.querySelector('[data-cd-link-field="techLink"]')?.value?.trim() || "",
    ledLighting: {
      voltage: document.getElementById("cdLedVoltage")?.value || "",
      color: document.getElementById("cdLedColor")?.value?.trim() || "",
      profile: document.getElementById("cdLedProfile")?.value?.trim() || "",
      controller: document.getElementById("cdLedController")?.value?.trim() || "",
      notes: document.getElementById("cdLedNotes")?.value?.trim() || ""
    },
    customLinks
  };
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

let actionsBound = false;

export function bindConstructorDeskActions(onChange = () => {}) {
  if (actionsBound) return;
  actionsBound = true;

  document.addEventListener("click", async (e) => {
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
      onChange();
      return;
    }

    if (e.target.closest("#cdBackToOrder")) {
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      onChange();
      return;
    }

    if (e.target.closest("#cdOnlyMineToggle")) {
      state.constructorDesk.onlyMine = e.target.checked;
      state.constructorDesk.selectedOrderId = null;
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      await loadConstructorDesk();
      onChange();
      return;
    }

    const saveAssignBtn = e.target.closest("[data-cd-save-assign]");
    if (saveAssignBtn) {
      const id = Number(saveAssignBtn.dataset.cdSaveAssign);
      const userId = document.querySelector(`[data-cd-assign-user="${id}"]`)?.value;
      const due = document.querySelector(`[data-cd-due="${id}"]`)?.value;
      const hours = document.querySelector(`[data-cd-hours="${id}"]`)?.value;
      try {
        await api.assignConstructorDesk(id, {
          constructorUserId: userId ? Number(userId) : null,
          constructorDueAt: due ? new Date(due).toISOString() : null,
          constructorEstimatedHours: hours ? Number(hours) : null
        });
        toastSuccess("Призначення збережено");
        await loadConstructorDesk();
        onChange();
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

    if (e.target.closest("#cdWsSuggestTiming")) {
      const id = state.constructorDesk.selectedPositionId;
      try {
        const s = await api.suggestConstructorTiming(id);
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
      const id = state.constructorDesk.selectedPositionId;
      try {
        await api.assignConstructorDesk(id, {
          constructorUserId: Number(document.getElementById("cdWsAssignUser")?.value) || null,
          constructorDueAt: document.getElementById("cdWsDue")?.value
            ? new Date(document.getElementById("cdWsDue").value).toISOString()
            : null,
          constructorEstimatedHours: document.getElementById("cdWsHours")?.value
            ? Number(document.getElementById("cdWsHours").value)
            : null
        });
        toastSuccess("Призначення збережено");
        await openConstructorWorkspace(id);
        await loadConstructorDesk();
        onChange();
      } catch (err) {
        toastError(err.message);
      }
      return;
    }

    const uploadBtn = e.target.closest("[data-cd-upload]");
    if (uploadBtn) {
      const kind = uploadBtn.dataset.cdUpload;
      const positionId = Number(uploadBtn.dataset.cdPosition);
      const input = document.querySelector(`[data-cd-file-kind="${kind}"]`);
      const labelInput = document.querySelector(`[data-cd-file-label="${kind}"]`);
      const file = input?.files?.[0];
      if (!file) {
        toastError("Оберіть файл");
        return;
      }
      try {
        const dataBase64 = await fileToBase64(file);
        await api.uploadConstructorDeskFile(positionId, {
          kind,
          label: labelInput?.value?.trim() || file.name,
          fileName: file.name,
          mime: file.type,
          dataBase64
        });
        toastSuccess("Файл завантажено");
        await openConstructorWorkspace(positionId);
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
    }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target?.id !== "cdCommentForm") return;
    e.preventDefault();
    const id = state.constructorDesk.selectedPositionId;
    const body = document.getElementById("cdCommentBody")?.value?.trim();
    if (!body) return;
    try {
      state.constructorDesk.detail = await api.addConstructorDeskComment(id, { body });
      toastSuccess("Коментар додано");
      onChange();
    } catch (err) {
      toastError(err.message);
    }
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#cdSaveWorkspace")) return;
    const id = state.constructorDesk.selectedPositionId;
    const workspace = readWorkspaceFromDom();
    const btn = e.target.closest("#cdSaveWorkspace");
    await runSave("Робоча сторінка конструктора", {
      submitEl: btn,
      saveFn: () => api.saveConstructorDeskWorkspace(id, { workspace, strict: true }),
      successMessage: "Збережено",
      onSuccess: async () => {
        await openConstructorWorkspace(id);
        await loadConstructorDesk();
        onChange();
      }
    }).catch(() => {});
  });
}
