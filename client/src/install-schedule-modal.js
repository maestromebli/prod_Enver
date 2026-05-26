import { api } from "./api.js";
import { canEditPositions } from "./auth.js";
import { parseUaDate, toIsoDate, fromIsoDate, addDays } from "./install-calendar-dates.js";
import { dayPresetOptions, getInstallDayRange, inputDateToUa } from "./install-calendar-days.js";
import { getInstallScheduleCandidates, positionInstallLabel } from "./install-utils.js";
import { state } from "./state.js";
import { $, escapeHtml } from "./utils.js";
import { runSave } from "./save-flow.js";
import { toastError } from "./toast.js";

let onSaved = () => {};
let draft = null;

function backdrop() {
  return $("#installScheduleModal");
}

function ensureModal() {
  let existing = document.getElementById("installScheduleModal");
  if (existing && !existing.querySelector("#installSchedulePositionId")) {
    existing.remove();
    existing = null;
  }
  if (existing) return;

  const el = document.createElement("div");
  el.id = "installScheduleModal";
  el.className = "modal-backdrop";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="modal install-schedule-modal" role="dialog" aria-labelledby="installScheduleTitle">
      <div class="modal-header">
        <h2 id="installScheduleTitle">Планування монтажу</h2>
        <button type="button" class="modal-close" id="closeInstallScheduleModal" aria-label="Закрити">×</button>
      </div>
      <form id="installScheduleForm">
        <div class="modal-body">
          <p class="form-error" id="installScheduleFormError"></p>
          <div class="form-field install-position-picker">
            <label for="installSchedulePositionSearch">Позиція</label>
            <input type="hidden" id="installSchedulePositionId" />
            <input
              type="search"
              id="installSchedulePositionSearch"
              class="install-position-search"
              placeholder="Пошук за номером, виробом або об'єктом…"
              autocomplete="off"
              enterkeyhint="search"
            />
            <div class="install-position-picker-list" id="installSchedulePositionList" role="listbox" aria-label="Позиції"></div>
            <p class="form-hint" id="installSchedulePositionHint"></p>
          </div>
          <div class="form-grid">
            <div class="form-field">
              <label for="installScheduleDateStart">Початок (день)</label>
              <input id="installScheduleDateStart" type="date" required />
            </div>
            <div class="form-field">
              <label for="installScheduleDateEnd">Кінець (день)</label>
              <input id="installScheduleDateEnd" type="date" required />
            </div>
            <div class="form-field span-2">
              <label for="installScheduleInstaller">Монтажник</label>
              <input id="installScheduleInstaller" list="installScheduleInstallersList" required />
              <datalist id="installScheduleInstallersList"></datalist>
            </div>
          </div>
          <div class="install-presets" id="installSchedulePresets"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" id="clearInstallScheduleBtn" style="margin-right: auto">Зняти з календаря</button>
          <button type="button" class="btn" id="cancelInstallScheduleBtn">Скасувати</button>
          <button type="submit" class="btn btn-primary">Зберегти</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(el);

  $("#closeInstallScheduleModal")?.addEventListener("click", closeInstallScheduleModal);
  $("#cancelInstallScheduleBtn")?.addEventListener("click", closeInstallScheduleModal);
  el.addEventListener("click", (e) => {
    if (e.target === el) closeInstallScheduleModal();
  });

  const notifyUiChanged = () => document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  $("#installScheduleForm")?.addEventListener("input", notifyUiChanged);
  $("#installScheduleForm")?.addEventListener("change", notifyUiChanged);
  $("#installSchedulePositionSearch")?.addEventListener("input", () => {
    const search = $("#installSchedulePositionSearch");
    const id = getSelectedPositionId();
    if (id && search) {
      const position = state.positions.find((p) => p.id === id);
      const label = position ? positionInstallLabel(position) : "";
      if (search.value !== label) setSelectedPositionId(null);
    }
    renderPositionPicker(getSelectedPositionId());
  });
  $("#installSchedulePositionSearch")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  $("#installSchedulePositionList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-position-id]");
    if (!btn) return;
    e.preventDefault();
    selectInstallSchedulePosition(Number(btn.dataset.positionId));
  });
  $("#installScheduleForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveInstallSchedule();
  });

  $("#clearInstallScheduleBtn")?.addEventListener("click", async () => {
    const positionId = getSelectedPositionId() || draft?.positionId;
    if (!positionId) return;
    await runSave("Монтаж", {
      saveFn: () => api.patchPositionInstall(positionId, { clear: true }),
      successMessage: "Монтаж знято з календаря",
      onSuccess: async () => {
        closeInstallScheduleModal();
        await onSaved();
      },
      onError: (err) => showError(err.message)
    }).catch(() => {});
  });

  $("#installSchedulePresets")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset-days]");
    if (!btn) return;
    const start = $("#installScheduleDateStart").value;
    if (!start) return;
    const days = Number(btn.dataset.presetDays);
    const end = addDays(fromIsoDate(start), days - 1);
    $("#installScheduleDateEnd").value = toIsoDate(end);
  });
}

function showError(msg) {
  const el = $("#installScheduleFormError");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("visible", Boolean(msg));
}

function isoFromUa(ua) {
  const d = parseUaDate(ua);
  return d ? toIsoDate(d) : "";
}

function getSelectedPositionId() {
  const raw = $("#installSchedulePositionId")?.value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function setSelectedPositionId(positionId) {
  const hidden = $("#installSchedulePositionId");
  if (!hidden) return;
  hidden.value = positionId ? String(positionId) : "";
}

function positionPickerFilterText() {
  return ($("#installSchedulePositionSearch")?.value || "").trim().toLowerCase();
}

function positionMatchesFilter(position, filter) {
  if (!filter) return true;
  const text = [
    position.id,
    position.orderNumber,
    position.item,
    position.object,
    positionInstallLabel(position)
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(filter);
}

function renderPositionPicker(selectedId) {
  const listEl = $("#installSchedulePositionList");
  if (!listEl) return;

  const selectedNum = selectedId != null && selectedId !== "" ? Number(selectedId) : null;
  const candidates = getInstallScheduleCandidates(state.positions, selectedNum);
  const filter = positionPickerFilterText();
  const filtered = filter ? candidates.filter((p) => positionMatchesFilter(p, filter)) : candidates;

  setSelectedPositionId(selectedNum);

  if (!filtered.length) {
    listEl.innerHTML = `<p class="install-position-empty">${escapeHtml(
      candidates.length
        ? "Нічого не знайдено — змініть пошук"
        : "Немає позицій. Змініть статус замовлення, щоб створити позицію."
    )}</p>`;
  } else {
    listEl.innerHTML = filtered
      .map((p) => {
        const selected = selectedNum != null && p.id === selectedNum;
        return `<button type="button" class="install-position-option${selected ? " is-selected" : ""}" data-position-id="${p.id}" role="option" aria-selected="${selected}">
          <span class="install-position-option-title">${escapeHtml(positionInstallLabel(p))}</span>
        </button>`;
      })
      .join("");
  }

  const hint = $("#installSchedulePositionHint");
  if (hint) {
    hint.textContent = candidates.length
      ? `${candidates.length} поз. — натисніть рядок, щоб обрати`
      : "";
    hint.classList.toggle("visible", Boolean(candidates.length));
  }
}

function selectInstallSchedulePosition(positionId) {
  if (!positionId) return;
  const position = state.positions.find((p) => p.id === positionId);
  const search = $("#installSchedulePositionSearch");
  if (search && position) search.value = positionInstallLabel(position);
  setSelectedPositionId(positionId);
  renderPositionPicker(positionId);
  syncInstallScheduleFieldsFromPosition(positionId);
  notifyUiChanged();
  requestAnimationFrame(() => {
    document
      .querySelector(".install-position-option.is-selected")
      ?.scrollIntoView({ block: "nearest" });
  });
}

function notifyUiChanged() {
  document.dispatchEvent(new CustomEvent("enver-ui-changed"));
}

function fillPositionOptions(selectedId) {
  const search = $("#installSchedulePositionSearch");
  const selectedNum = selectedId != null && selectedId !== "" ? Number(selectedId) : null;
  if (search) {
    if (selectedNum) {
      const position = state.positions.find((p) => p.id === selectedNum);
      search.value = position ? positionInstallLabel(position) : "";
    } else {
      search.value = "";
    }
  }
  renderPositionPicker(selectedId);
}

function syncInstallScheduleFieldsFromPosition(positionId) {
  if (!positionId) return;
  const position = state.positions.find((p) => p.id === positionId);
  if (!position) return;

  draft = { positionId };

  const isoStart = position.installDate
    ? isoFromUa(position.installDate)
    : $("#installScheduleDateStart").value || toIsoDate(new Date());
  const range = getInstallDayRange(position);
  const isoEnd = range ? toIsoDate(range.end) : isoStart;

  $("#installScheduleDateStart").value = isoStart;
  $("#installScheduleDateEnd").value = isoEnd;
  $("#installScheduleInstaller").value = position.installResponsible || "";
  $("#installScheduleTitle").textContent = position.installDate
    ? "Редагувати монтаж"
    : "Запланувати монтаж";
  $("#clearInstallScheduleBtn").style.display = position.installDate ? "" : "none";
}

function fillInstallersList() {
  const list = $("#installScheduleInstallersList");
  const names = state.directories["Монтажники"] || [];
  list.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join("");
}

function fillPresets() {
  $("#installSchedulePresets").innerHTML = `
    <span class="install-presets-label">Тривалість:</span>
    ${dayPresetOptions()
      .map(
        (p) =>
          `<button type="button" class="btn btn-sm" data-preset-days="${p.days}">${escapeHtml(p.label)}</button>`
      )
      .join("")}
  `;
}

export function setInstallScheduleSaveHandler(handler) {
  onSaved = handler;
}

export function openInstallScheduleModal(options = {}) {
  if (!canEditPositions()) {
    toastError("Немає прав на редагування");
    return;
  }
  ensureModal();
  const position =
    options.position ||
    (options.positionId ? state.positions.find((p) => p.id === options.positionId) : null);

  const isoStart =
    options.isoDay ||
    (position?.installDate ? isoFromUa(position.installDate) : toIsoDate(new Date()));
  const range = position ? getInstallDayRange(position) : null;
  const isoEnd = range ? toIsoDate(range.end) : isoStart;

  draft = { positionId: position?.id ?? null };

  fillPositionOptions(position?.id ?? options.positionId);
  fillInstallersList();
  fillPresets();

  $("#installScheduleDateStart").value = isoStart;
  $("#installScheduleDateEnd").value = isoEnd;
  $("#installScheduleInstaller").value = position?.installResponsible || "";

  $("#installScheduleTitle").textContent = position?.installDate
    ? "Редагувати монтаж"
    : "Запланувати монтаж";
  $("#clearInstallScheduleBtn").style.display = position?.installDate ? "" : "none";

  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function closeInstallScheduleModal() {
  const el = backdrop();
  if (!el) return;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  draft = null;
}

export function captureInstallScheduleOverlay() {
  const el = backdrop();
  if (!el?.classList.contains("open")) return null;
  return {
    positionId: getSelectedPositionId() || draft?.positionId || null,
    isoStart: $("#installScheduleDateStart").value,
    isoEnd: $("#installScheduleDateEnd").value,
    installer: $("#installScheduleInstaller").value
  };
}

export function restoreInstallScheduleOverlay(saved) {
  if (!saved) return;
  const position = saved.positionId ? state.positions.find((p) => p.id === saved.positionId) : null;
  openInstallScheduleModal({
    position,
    positionId: saved.positionId,
    isoDay: saved.isoStart || undefined
  });
  if (saved.isoStart) $("#installScheduleDateStart").value = saved.isoStart;
  if (saved.isoEnd) $("#installScheduleDateEnd").value = saved.isoEnd;
  if (saved.installer != null) $("#installScheduleInstaller").value = saved.installer;
}

async function saveInstallSchedule() {
  showError("");
  const positionId = getSelectedPositionId();
  const isoStart = $("#installScheduleDateStart").value;
  const isoEnd = $("#installScheduleDateEnd").value;
  const installer = $("#installScheduleInstaller").value.trim();

  if (!positionId) {
    showError("Оберіть позицію");
    return;
  }
  if (!installer) {
    showError("Вкажіть монтажника");
    return;
  }
  if (!isoStart || !isoEnd) {
    showError("Вкажіть дати початку та кінця");
    return;
  }
  if (fromIsoDate(isoEnd) < fromIsoDate(isoStart)) {
    showError("Кінець не може бути раніше початку");
    return;
  }

  const submitBtn = $("#installScheduleForm")?.querySelector('[type="submit"]');

  await runSave("Монтаж", {
    submitEl: submitBtn,
    saveFn: async () => {
      const updated = await api.patchPositionInstall(positionId, {
        installDate: inputDateToUa(isoStart),
        installEndDate: inputDateToUa(isoEnd),
        installResponsible: installer,
        installTimeStart: "",
        installTimeEnd: ""
      });
      const idx = state.positions.findIndex((p) => p.id === positionId);
      if (idx >= 0) state.positions[idx] = updated;
      return updated;
    },
    successMessage: "Монтаж заплановано",
    onSuccess: async () => {
      closeInstallScheduleModal();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

export function initInstallScheduleModal() {
  ensureModal();
}
