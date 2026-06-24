import { api, apiUrl, getStoredToken } from "./api.js";
import { runSave } from "./save-flow.js";
import { loadPositionHistory, renderDrawerHistory } from "./history.js";
import { expandPosition, getParentPosition } from "./position-tree.js";
import { state } from "./state.js";
import {
  POSITION_STATUSES,
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGE_STATUSES,
  STAGES,
  getNextStatus,
  getStageStatus,
  stageStatusClass
} from "./workflows.js";
import { PIPELINE_STAGES, STAGE_STATUS_DONE, stageLabel } from "@enver/shared/production/stages.js";
import { renderNextActionBanner, resolvePositionGodmode } from "./godmode-ui.js";
import {
  $,
  badge,
  escapeHtml,
  fillSelect,
  humanizeUserMessage,
  progressBar,
  showFormError
} from "./utils.js";

let onSaved = () => {};
let draft = null;
let activePanel = "general";

export function setPositionSaveHandler(handler) {
  onSaved = handler;
}

function normalizeSuggestedTasks(result) {
  const raw = result?.suggestedTasks || [];
  return raw.map((t) => {
    if (typeof t === "string") {
      const map = {
        порізка: "cutting",
        крайкування: "edging",
        кромкування: "edging",
        присадка: "drilling",
        збірка: "assembly",
        пакування: "packaging"
      };
      const key = map[t.toLowerCase()] || t;
      return { stage: key, needed: true, reason: "", confidence: 0.7 };
    }
    return t;
  });
}

function renderAiAnalysisResult(result) {
  const tasks = normalizeSuggestedTasks(result).filter((t) => t.needed !== false);
  const highConf = tasks.every((t) => (t.confidence ?? 0.8) >= 0.8);
  const missing = result.missingInfo || [];

  const taskRows = tasks
    .map((t) => {
      const conf = Math.round((t.confidence ?? 0.8) * 100);
      const checked = (t.confidence ?? 0.8) >= 0.8 ? "checked" : "";
      return `<label class="ai-task-row">
        <input type="checkbox" data-task-stage value="${escapeHtml(t.stage)}" ${checked} />
        <span><strong>${escapeHtml(stageLabel(t.stage))}</strong> — ${escapeHtml(t.reason || "рекомендовано")} (${conf}%)</span>
      </label>`;
    })
    .join("");

  return `
    <div class="analysis-card">
      <p><strong>${escapeHtml(result.summary || "—")}</strong></p>
      ${result.estimatedComplexity ? `<p>Складність: ${escapeHtml(result.estimatedComplexity)}</p>` : ""}
      ${result.materials?.length ? `<p>Матеріали: ${result.materials.map(escapeHtml).join(", ")}</p>` : ""}
      ${result.warnings?.length ? `<p class="form-error visible">${result.warnings.map(escapeHtml).join("; ")}</p>` : ""}
      ${missing.length ? `<p class="form-error visible">Бракує даних: ${missing.map(escapeHtml).join("; ")}</p>` : ""}
      ${tasks.length ? `<div class="ai-task-list">${taskRows}</div>` : ""}
      ${
        tasks.length
          ? `<div class="constructive-actions" style="margin-top:10px">
        <button type="button" class="btn btn-sm btn-primary" id="createTasksBtn">${highConf ? "Створити всі рекомендовані задачі" : "Створити тільки обрані"}</button>
        <button type="button" class="btn btn-sm" id="rejectAiTasksBtn">Відхилити</button>
      </div>`
          : ""
      }
    </div>`;
}

function backdrop() {
  return $("#positionDrawer");
}

function showError(message) {
  showFormError("#positionFormError", message);
}

async function renderPositionQr(positionId, stageKey) {
  const box = $("#positionQrBox");
  if (!box || !positionId) return;
  box.innerHTML = '<p class="enver-muted">Генерація QR…</p>';
  try {
    const token = getStoredToken();
    const stage = stageKey || draft?.currentStage || "cutting";
    const res = await fetch(
      apiUrl(`/api/positions/${positionId}/qr?stage=${encodeURIComponent(stage)}`),
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) throw new Error("Не вдалося згенерувати QR");
    const svg = await res.text();
    const meta = await api.getPositionQrUrl(positionId, stage);
    box.innerHTML = `
      <div class="qr-box-visual">${svg}</div>
      <p class="qr-box-url">${escapeHtml(meta.url)}</p>
      <button type="button" class="btn btn-sm" id="copyPositionQrUrlBtn">Скопіювати посилання</button>`;
    $("#copyPositionQrUrlBtn")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(meta.url);
        const { toastSuccess } = await import("./toast.js");
        toastSuccess("Посилання скопійовано");
      } catch {
        const { toastError } = await import("./toast.js");
        toastError("Не вдалося скопіювати");
      }
    });
  } catch (err) {
    box.innerHTML = `<p class="form-error visible">${escapeHtml(humanizeUserMessage(err.message))}</p>`;
  }
}

function listOptions(key) {
  return state.directories[key] || [];
}

function applyOrderDefaults(orderNumber) {
  const order = state.orders.find((o) => o.orderNumber === orderNumber);
  if (!order) return;
  draft.orderId = order.id;
  draft.orderNumber = order.orderNumber;
  draft.object = order.object;
  if (!draft.manager) draft.manager = order.manager;
}

function renderPipeline() {
  const currentKey = draft.currentStage || "constructor";
  const currentStage = STAGES.find((s) => s.key === currentKey) || STAGES[0];
  const currentStatus = getStageStatus(draft, currentStage);
  const next = getNextStatus(currentStatus);
  const canAdvance = currentStatus !== "Готово" && currentStatus !== "Не потрібно";

  const track = PIPELINE_STAGES.map((stage) => {
    const status = getStageStatus(draft, stage);
    let dotCls = "step-dot";
    if (status === "Проблема") dotCls += " step-dot--problem";
    else if (STAGE_STATUS_DONE.has(status)) dotCls += " step-dot--done";
    else if (stage.key === currentKey) dotCls += " step-dot--current";
    else if (status !== "Не розпочато") dotCls += " step-dot--active";
    return `<button type="button" class="${dotCls}" data-pipeline-jump="${stage.key}" title="${escapeHtml(stage.label)}: ${escapeHtml(status)}"></button>`;
  }).join('<span class="step-line" aria-hidden="true"></span>');

  const manualSteps = STAGES.filter((s) => s.field)
    .map((stage) => {
      const status = getStageStatus(draft, stage);
      const cls = stageStatusClass(status);
      return `
        <div class="pipeline-manual-row ${cls}">
          <span class="pipeline-manual-label">${escapeHtml(stage.label)}</span>
          <select class="pipeline-select" data-pipeline-status="${stage.key}" aria-label="${escapeHtml(stage.label)}">
            ${STAGE_STATUSES.map(
              (s) =>
                `<option value="${escapeHtml(s)}" ${s === status ? "selected" : ""}>${escapeHtml(s)}</option>`
            ).join("")}
          </select>
        </div>`;
    })
    .join("");

  return `
    <div class="pipeline-compact">
      <div class="pipeline-compact-now">
        <span class="pipeline-compact-icon">${currentStage.icon}</span>
        <div class="pipeline-compact-text">
          <strong>${escapeHtml(currentStage.label)}</strong>
          <span>${badge(currentStatus)}</span>
        </div>
        ${
          canAdvance
            ? `<button type="button" class="btn btn-primary btn-sm" data-pipeline-advance="${currentStage.key}" data-next="${escapeHtml(next)}">Далі → ${escapeHtml(next)}</button>`
            : ""
        }
      </div>
      <div class="step-track step-track--drawer">${track}</div>
      <details class="pipeline-manual">
        <summary>Змінити етап вручну</summary>
        <div class="pipeline-manual-grid">${manualSteps}</div>
      </details>
    </div>`;
}

function renderDrawerContent() {
  const p = draft;
  const godmodeBanner =
    p.id && !p.parentId
      ? renderNextActionBanner(resolvePositionGodmode(p), { positionId: p.id, showCta: true })
      : "";
  const orderOptions = state.orders
    .map(
      (o) =>
        `<option value="${escapeHtml(o.orderNumber)}">${escapeHtml(o.orderNumber)} — ${escapeHtml(o.object)}</option>`
    )
    .join("");

  $("#positionDrawerBody").innerHTML = `
    <p class="form-error" id="positionFormError"></p>
    ${godmodeBanner}

    <div class="drawer-section drawer-section--pipeline">
      <div class="pipeline" id="positionPipeline">${renderPipeline()}</div>
    </div>
    ${
      p.id
        ? `<div class="drawer-section drawer-section--qr" id="positionQrSection">
      <div class="drawer-qr-head">
        <div>
          <h3 class="drawer-qr-title">QR для цеху</h3>
          <p class="field-hint">Оператор сканує код на планшеті — відкривається ця позиція на поточному етапі.</p>
        </div>
        <button type="button" class="btn btn-sm enver-button-secondary" id="generatePositionQrBtn">Оновити QR</button>
      </div>
      <div id="positionQrBox" class="qr-box" aria-live="polite"></div>
    </div>`
        : ""
    }

    <div class="drawer-tabs">
      <button type="button" class="drawer-tab ${activePanel === "general" ? "active" : ""}" data-panel="general">Основне</button>
      <button type="button" class="drawer-tab ${activePanel === "install" ? "active" : ""}" data-panel="install">Монтаж</button>
      <button type="button" class="drawer-tab ${activePanel === "more" ? "active" : ""}" data-panel="more">Ще</button>
    </div>

    <form id="positionForm">
      <input type="hidden" id="positionId" value="${p.id ?? ""}" />

      <div class="drawer-panel ${activePanel === "general" ? "active" : ""}" data-panel="general">
        ${
          p.parentId
            ? `<p class="drawer-parent-note">Підпозиція в межах: <strong>${escapeHtml(draft._parentItem || "—")}</strong> (замовлення ${escapeHtml(p.orderNumber)})</p>`
            : ""
        }
        <div class="form-grid">
          <div class="form-field span-2">
            <label for="posItem">${p.parentId ? "Назва зони *" : "Виріб / зона *"}</label>
            <input id="posItem" value="${escapeHtml(p.item)}" required />
          </div>
          ${
            p.parentId
              ? ""
              : `<div class="form-field span-2">
            <label for="posOrderNumber">Замовлення *</label>
            <select id="posOrderNumber" required>
              <option value="">— оберіть —</option>
              ${orderOptions}
              ${p.orderNumber && !state.orders.some((o) => o.orderNumber === p.orderNumber) ? `<option value="${escapeHtml(p.orderNumber)}" selected>${escapeHtml(p.orderNumber)}</option>` : ""}
            </select>
          </div>`
          }
          <div class="form-field">
            <label for="posConstructor">Конструктор</label>
            <input id="posConstructor" list="constructorsList" value="${escapeHtml(p.constructor)}" />
            <datalist id="constructorsList"></datalist>
          </div>
          <div class="form-field">
            <label for="posAssembler">Збирач</label>
            <input id="posAssembler" list="assemblersList" value="${escapeHtml(p.assemblyResponsible)}" />
            <datalist id="assemblersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "install" ? "active" : ""}" data-panel="install">
        <div class="form-grid">
          <div class="form-field">
            <label for="posInstallDate">Початок монтажу</label>
            <input id="posInstallDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installDate)}" />
          </div>
          <div class="form-field">
            <label for="posInstallEndDate">Кінець монтажу</label>
            <input id="posInstallEndDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installEndDate || p.installDate || "")}" />
          </div>
          <div class="form-field span-2">
            <label for="posInstaller">Монтажник</label>
            <input id="posInstaller" list="installersList" value="${escapeHtml(p.installResponsible)}" />
            <datalist id="installersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "more" ? "active" : ""}" data-panel="more">
        <details class="drawer-more-block" ${p.hasConstructiveFile ? "open" : ""}>
          <summary>Конструктив</summary>
          <p class="field-hint">${p.hasConstructiveFile ? `Файл: <strong>${escapeHtml(p.constructiveFileName || "завантажено")}</strong>` : "PDF, ZIP, XML, TXT"}</p>
          ${
            p.id
              ? `<div class="constructive-actions">
            <input type="file" id="constructiveFileInput" accept=".pdf,.zip,.xml,.txt,.dwg,.dxf" hidden />
            <button type="button" class="btn btn-sm" id="pickConstructiveBtn">Завантажити</button>
            <button type="button" class="btn btn-sm" id="analyzeConstructiveBtn" ${p.hasConstructiveFile ? "" : "disabled"}>ШІ-аналіз</button>
          </div>
          <div id="constructiveAnalysis" class="constructive-analysis"></div>`
              : `<p class="field-hint">Збережіть позицію, щоб завантажити файл.</p>`
          }
        </details>
        <div class="form-grid" style="margin-top:12px">
          <div class="form-field span-2">
            <label for="posProblem">Проблема</label>
            <textarea id="posProblem" rows="2">${escapeHtml(p.problem)}</textarea>
          </div>
          <div class="form-field span-2">
            <label for="posNote">Примітка</label>
            <textarea id="posNote" rows="2">${escapeHtml(p.note)}</textarea>
          </div>
          <div class="form-field">
            <label for="posReadyDate">Дата готовності</label>
            <input id="posReadyDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.readyDate)}" />
          </div>
          <div class="form-field">
            <label for="posPositionStatus">Статус</label>
            <select id="posPositionStatus"></select>
          </div>
        </div>
        <div id="positionHistoryPanel" class="position-history-panel" style="margin-top:14px">
          <p class="history-muted">Завантаження історії…</p>
        </div>
      </div>
    </form>
  `;

  fillSelect($("#posPositionStatus"), POSITION_STATUSES, p.positionStatus);
  if (p.orderNumber && $("#posOrderNumber")) $("#posOrderNumber").value = p.orderNumber;

  $("#constructorsList").innerHTML = listOptions("Конструктори")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#assemblersList").innerHTML = listOptions("Збирачі")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#installersList").innerHTML = listOptions("Монтажники")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");

  bindDrawerEvents();
  if (activePanel === "more") refreshDrawerHistory();
}

async function refreshDrawerHistory() {
  const el = $("#positionHistoryPanel");
  if (!el) return;
  if (!draft?.id) {
    el.innerHTML = '<p class="note">Збережіть позицію, щоб переглядати історію змін.</p>';
    return;
  }
  el.innerHTML = '<p class="history-muted">Завантаження…</p>';
  try {
    const entries = await loadPositionHistory(draft.id);
    el.innerHTML = renderDrawerHistory(entries);
  } catch (err) {
    el.innerHTML = `<p class="form-error visible">${escapeHtml(err.message)}</p>`;
  }
}

function updateHeader() {
  const kind = draft.parentId ? "Підпозиція" : "Позиція";
  $("#positionDrawerTitle").textContent =
    draft.item || (draft.parentId ? "Нова підпозиція" : "Нова позиція");
  $("#positionDrawerSubtitle").innerHTML = `
    <span class="meta-pill">${kind}</span>
    <span class="meta-pill">#${draft.id || "нова"}</span>
    <span class="meta-pill">${escapeHtml(draft.orderNumber || "—")}</span>
    ${badge(draft.positionStatus || "Не розпочато")}
  `;
  $("#positionDrawerProgress").innerHTML = progressBar(draft.progress ?? 0);
  $("#positionDrawerProgressLabel").textContent = `${draft.progress ?? 0}% готово`;
}

function pipelineStatus(key, field) {
  const sel = document.querySelector(`.pipeline-select[data-pipeline-status="${key}"]`);
  return sel?.value ?? draft[field] ?? "Не розпочато";
}

function readForm() {
  const orderNumber = draft.parentId
    ? draft.orderNumber
    : $("#posOrderNumber")?.value.trim() || draft.orderNumber;
  const order = state.orders.find((o) => o.orderNumber === orderNumber);
  return {
    parentId: draft.parentId ?? null,
    orderId: order?.id ?? draft.orderId ?? null,
    orderNumber,
    object: draft.object || order?.object || "",
    item: $("#posItem").value.trim(),
    itemType: draft.itemType || "Зона",
    manager: draft.manager || order?.manager || "",
    constructor: $("#posConstructor")?.value.trim() ?? "",
    cuttingStatus: pipelineStatus("cutting", "cuttingStatus"),
    edgingStatus: pipelineStatus("edging", "edgingStatus"),
    drillingStatus: pipelineStatus("drilling", "drillingStatus"),
    assemblyStatus: pipelineStatus("assembly", "assemblyStatus"),
    packagingStatus: pipelineStatus("packaging", "packagingStatus"),
    assemblyResponsible: $("#posAssembler")?.value.trim() ?? "",
    readyDate: $("#posReadyDate")?.value.trim() ?? "",
    installDate: $("#posInstallDate")?.value.trim() ?? "",
    installEndDate: $("#posInstallEndDate")?.value.trim() ?? "",
    installTimeStart: "",
    installTimeEnd: "",
    installResponsible: $("#posInstaller")?.value.trim() ?? "",
    positionStatus: $("#posPositionStatus")?.value ?? draft.positionStatus,
    overdueDays: Number(draft.overdueDays) || 0,
    problem: $("#posProblem")?.value.trim() ?? "",
    note: $("#posNote")?.value.trim() ?? ""
  };
}

function syncDraftFromForm() {
  Object.assign(draft, readForm());
  draft.progress = estimateProgress(draft);
}

function estimateProgress(p) {
  let weighted = 0;
  for (const stage of STAGES) {
    const w = PRODUCTION_PROGRESS_WEIGHTS[stage.key];
    if (!w) continue;
    const st = getStageStatus(p, stage);
    let score = 0;
    if (st === "Готово" || st === "Не потрібно") score = 100;
    else if (st === "В роботі") score = 65;
    else if (st === "Передано") score = 35;
    weighted += w * score;
  }
  return Math.round(weighted / 100);
}

async function patchStage(stageKey, payload) {
  if (!draft.id) {
    showError("Спочатку збережіть позицію");
    return;
  }
  const stage = STAGES.find((s) => s.key === stageKey);
  const stageName = stage?.label || stageKey;

  await runSave(`Етап «${stageName}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(draft.id, stageKey, payload);
      draft = { ...updated };
      return updated;
    },
    successMessage: `Етап «${stageName}» збережено`,
    onSuccess: async () => {
      updateHeader();
      renderDrawerContent();
      if (activePanel === "more") await refreshDrawerHistory();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

async function savePosition() {
  showError("");
  syncDraftFromForm();

  if (!draft.item) {
    showError("Вкажіть назву виробу");
    activePanel = "general";
    renderDrawerContent();
    return;
  }
  if (!draft.orderNumber) {
    showError("Оберіть замовлення");
    activePanel = "general";
    renderDrawerContent();
    return;
  }

  const isEdit = Boolean(draft.id);
  const submitBtn = $("#positionForm")?.querySelector('[type="submit"]');

  await runSave(isEdit ? "Позиція" : "Нова позиція", {
    submitEl: submitBtn,
    saveFn: async () => {
      const body = readForm();
      if (isEdit) {
        return api.updatePosition(draft.id, body);
      }
      const created = await api.createPosition(body);
      if (created.parentId) expandPosition(created.parentId);
      return created;
    },
    successMessage: isEdit ? "Позицію збережено" : "Позицію створено",
    onSuccess: async () => {
      closePositionDrawer();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

async function deletePosition() {
  if (!draft.id) return;
  const kind = draft.parentId ? "підпозицію" : "позицію";
  if (!window.confirm(`Видалити ${kind} #${draft.id} «${draft.item}»?`)) return;

  await runSave("Позиція", {
    saveFn: () => api.deletePosition(draft.id),
    successMessage: "Позицію видалено",
    onSuccess: async () => {
      closePositionDrawer();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

function scrollPositionDrawerToTabs() {
  requestAnimationFrame(() => {
    const body = $("#positionDrawerBody");
    const tabs = body?.querySelector(".drawer-tabs");
    if (!body || !tabs) return;
    body.scrollTo({ top: Math.max(0, tabs.offsetTop - 8), behavior: "smooth" });
  });
}

function onDrawerTabSelect(panel) {
  if (!panel) return;
  activePanel = panel;
  syncDraftFromForm();
  renderDrawerContent();
  scrollPositionDrawerToTabs();
  if (activePanel === "more") refreshDrawerHistory();
}

function bindDrawerEvents() {
  $("#positionForm")?.addEventListener("input", () => {
    document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  });
  $("#positionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    savePosition();
  });

  $("#posOrderNumber")?.addEventListener("change", (e) => {
    applyOrderDefaults(e.target.value);
    $("#posObject").value = draft.object || "";
    $("#posManager").value = draft.manager || "";
  });

  document.querySelectorAll("[data-pipeline-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.pipelineJump;
      const stage = STAGES.find((s) => s.key === key);
      if (!stage || key === draft.currentStage) return;
      if (stage.type === "constructor") {
        if (!draft.hasConstructiveFile) {
          onDrawerTabSelect("more");
          showError("Завантажте файл конструктива");
          return;
        }
        await patchStage(key, { status: "Передано", constructor: draft.constructor });
        return;
      }
      await patchStage(key, {
        status: "В роботі",
        assemblyResponsible: draft.assemblyResponsible
      });
    });
  });

  document.querySelectorAll("[data-pipeline-advance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.pipelineAdvance;
      const next = btn.dataset.next;
      const stage = STAGES.find((s) => s.key === key);
      if (stage.type === "constructor") {
        if (!draft.hasConstructiveFile && next !== "Не розпочато") {
          onDrawerTabSelect("more");
          showError("Завантажте файл конструктива");
          return;
        }
        await patchStage(key, { status: next, constructor: draft.constructor });
      } else {
        await patchStage(key, {
          status: next,
          assemblyResponsible: draft.assemblyResponsible
        });
      }
    });
  });

  document.querySelectorAll(".pipeline-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const key = sel.dataset.pipelineStatus;
      const stage = STAGES.find((s) => s.key === key);
      const status = sel.value;
      if (stage.type === "constructor") {
        await patchStage(key, { status, constructor: draft.constructor });
      } else {
        await patchStage(key, { status, assemblyResponsible: draft.assemblyResponsible });
      }
    });
  });

  $("#pickConstructiveBtn")?.addEventListener("click", () => $("#constructiveFileInput")?.click());

  $("#generatePositionQrBtn")?.addEventListener("click", () => {
    if (!draft?.id) return;
    void renderPositionQr(draft.id, draft.currentStage || "cutting");
  });

  if (draft?.id) {
    void renderPositionQr(draft.id, draft.currentStage || "cutting");
  }

  document.querySelectorAll("[data-run-next-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.runNextAction);
      const actionType = btn.dataset.actionType;
      await runSave("Наступна дія", {
        saveFn: () => api.runPositionNextAction(positionId, actionType),
        successMessage: "Дію виконано",
        onSuccess: async (updated) => {
          draft = { ...draft, ...updated };
          updateHeader();
          renderDrawerContent();
        }
      }).catch(() => {});
    });
  });

  $("#constructiveFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !draft.id) return;
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || "");
        resolve(raw.includes(",") ? raw.split(",")[1] : raw);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await runSave("Конструктив", {
      saveFn: () =>
        api.uploadConstructiveFile(draft.id, {
          fileName: file.name,
          mime: file.type,
          dataBase64
        }),
      successMessage: "Файл завантажено",
      onSuccess: async (res) => {
        draft = { ...draft, ...res.position, hasConstructiveFile: true };
        updateHeader();
        renderDrawerContent();
        await onSaved();
      },
      onError: (err) => showError(err.message)
    }).catch(() => {});
  });

  $("#analyzeConstructiveBtn")?.addEventListener("click", async () => {
    if (!draft.id) return;
    const box = $("#constructiveAnalysis");
    if (box) box.innerHTML = '<p class="history-muted">Аналіз ШІ…</p>';
    try {
      const result = await api.analyzeConstructive(draft.id);
      if (box) {
        box.innerHTML = renderAiAnalysisResult(result);
        $("#createTasksBtn")?.addEventListener("click", async () => {
          const stages = [];
          document
            .querySelectorAll("[data-task-stage]:checked")
            .forEach((cb) => stages.push(cb.value));
          if (!stages.length) {
            showError("Оберіть хоча б один етап");
            return;
          }
          await runSave("Задачі", {
            saveFn: () => api.createProductionTasks(draft.id, stages),
            successMessage: "Виробничі задачі створено",
            onSuccess: async (pos) => {
              draft = { ...draft, ...pos };
              updateHeader();
              renderDrawerContent();
              await onSaved();
            },
            onError: (err) => showError(err.message)
          }).catch(() => {});
        });
        $("#rejectAiTasksBtn")?.addEventListener("click", () => {
          if (box) box.innerHTML = '<p class="history-muted">Рекомендації відхилено.</p>';
        });
      }
    } catch (err) {
      if (box) box.innerHTML = `<p class="form-error visible">${escapeHtml(err.message)}</p>`;
    }
  });
}

export function openSubPositionDrawer(parentId) {
  const parent = getParentPosition(parentId);
  if (!parent) return;
  expandPosition(parentId);
  openPositionDrawer(null, {
    parentId,
    orderNumber: parent.orderNumber,
    orderId: parent.orderId,
    object: parent.object,
    manager: parent.manager,
    itemType: parent.itemType || "Кухня"
  });
}

export function capturePositionDrawerState() {
  if (!backdrop()?.classList.contains("open") || !draft) return null;
  syncDraftFromForm();
  const { _parentItem, ...draftData } = draft;
  return { activePanel, draft: draftData };
}

export function restorePositionDrawerState(saved) {
  if (!saved?.draft) return;
  activePanel = saved.activePanel || "general";
  draft = { ...saved.draft };
  if (draft.parentId) {
    const parent = getParentPosition(draft.parentId);
    if (parent) draft._parentItem = parent.item;
  }
  if (draft.orderNumber) applyOrderDefaults(draft.orderNumber);
  $("#positionDrawerTitle").textContent = draft.item || "Нова позиція";
  $("#deletePositionBtn").style.display = draft.id ? "inline-flex" : "none";
  updateHeader();
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function openPositionDrawer(position = null, options = {}) {
  if (options.restoredDraft) {
    restorePositionDrawerState({ activePanel: options.panel, draft: options.restoredDraft });
    return;
  }

  activePanel = options.panel || "general";
  const parentId = position?.parentId ?? options.parentId ?? null;
  const parent = parentId ? getParentPosition(parentId) : null;

  draft = position
    ? {
        ...position,
        _parentItem: (position.parentId ? getParentPosition(position.parentId) : parent)?.item
      }
    : {
        parentId,
        orderNumber: options.orderNumber || "",
        orderId: options.orderId || null,
        object: options.object || "",
        manager: options.manager || "",
        _parentItem: parent?.item,
        item: "",
        itemType: options.itemType || "Кухня",
        constructor: "",
        cuttingStatus: "Не розпочато",
        edgingStatus: "Не розпочато",
        drillingStatus: "Не розпочато",
        assemblyStatus: "Не розпочато",
        positionStatus: "Не розпочато",
        progress: 0,
        overdueDays: 0,
        problem: "",
        note: ""
      };

  if (draft.orderNumber) applyOrderDefaults(draft.orderNumber);

  $("#positionDrawerTitle").textContent = draft.item || "Нова позиція";
  $("#deletePositionBtn").style.display = draft.id ? "inline-flex" : "none";
  updateHeader();
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function closePositionDrawer() {
  backdrop().classList.remove("open");
  backdrop().setAttribute("aria-hidden", "true");
  draft = null;
}

export async function quickAdvancePosition(id, stageKey) {
  const position = state.positions.find((p) => p.id === id);
  if (!position) return;
  const stage = STAGES.find((s) => s.key === stageKey);
  if (!stage) return;
  const current = getStageStatus(position, stage);
  const next = getNextStatus(current);
  const payload =
    stage.type === "constructor"
      ? { status: next, constructor: position.constructor }
      : { status: next, assemblyResponsible: position.assemblyResponsible };

  await runSave(`Етап «${stage.label}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(id, stageKey, payload);
      const idx = state.positions.findIndex((p) => p.id === id);
      if (idx >= 0) state.positions[idx] = updated;
      return updated;
    },
    successMessage: `«${stage.label}»: ${next}`,
    onSuccess: () => onSaved()
  }).catch(() => {});
}

export function initPositionDrawer() {
  if (document.getElementById("positionDrawer")) return;

  const el = document.createElement("div");
  el.id = "positionDrawer";
  el.className = "drawer-backdrop";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="drawer" role="dialog" aria-labelledby="positionDrawerTitle">
      <div class="drawer-header">
        <div class="drawer-header-main">
          <h2 id="positionDrawerTitle">Позиція</h2>
          <div class="drawer-meta" id="positionDrawerSubtitle"></div>
          <div class="drawer-progress">
            <div class="drawer-progress-label">
              <span>Прогрес виробництва</span>
              <span id="positionDrawerProgressLabel">0%</span>
            </div>
            <div id="positionDrawerProgress"></div>
          </div>
        </div>
        <button type="button" class="modal-close" id="closePositionDrawer" aria-label="Закрити">×</button>
      </div>
      <div class="drawer-body" id="positionDrawerBody"></div>
      <div class="drawer-footer">
        <button type="button" class="btn btn-danger" id="deletePositionBtn" style="margin-right: auto; display: none">Видалити</button>
        <button type="button" class="btn" id="cancelPositionBtn">Закрити</button>
        <button type="submit" form="positionForm" class="btn btn-primary">Зберегти</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  $("#positionDrawerBody")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".drawer-tab");
    if (!tab?.dataset.panel) return;
    onDrawerTabSelect(tab.dataset.panel);
  });

  el.addEventListener("click", (e) => {
    if (e.target === el) closePositionDrawer();
  });
  $("#closePositionDrawer").addEventListener("click", closePositionDrawer);
  $("#cancelPositionBtn").addEventListener("click", closePositionDrawer);
  $("#deletePositionBtn").addEventListener("click", deletePosition);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("open")) closePositionDrawer();
  });
}

export function positionActionButtons(id, compact = false) {
  const label = compact ? "▸" : "Відкрити";
  return `
    <div class="actions-cell">
      <button type="button" class="btn btn-sm" data-edit-position="${id}">${label}</button>
    </div>
  `;
}

export function stageQuickActions(id, stageKey) {
  const position = state.positions.find((p) => p.id === id);
  if (!position) return "";
  const stage = STAGES.find((s) => s.key === stageKey);
  const status = getStageStatus(position, stage);
  const next = getNextStatus(status);
  if (status === "Готово" || status === "Не потрібно") {
    return `<span class="muted">✓</span>`;
  }
  return `
    <div class="stage-quick">
      <button type="button" class="btn btn-ghost btn-sm" data-quick-stage="${stageKey}" data-position-id="${id}" data-next="${escapeHtml(next)}">${escapeHtml(next)}</button>
      <button type="button" class="btn btn-sm" data-edit-position="${id}">⋯</button>
    </div>
  `;
}
