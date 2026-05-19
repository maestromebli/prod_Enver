import { api } from "./api.js";
import { canEditPositions } from "./auth.js";
import { formatUaDate, parseUaDate, toIsoDate, fromIsoDate, addDays } from "./install-calendar-dates.js";
import { dayPresetOptions, getInstallDayRange, inputDateToUa } from "./install-calendar-days.js";
import { isInstallRelevant } from "./install-utils.js";
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
  if (document.getElementById("installScheduleModal")) return;
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
          <div class="form-field">
            <label for="installSchedulePosition">Позиція</label>
            <select id="installSchedulePosition" required></select>
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
  `

  document.body.appendChild(el);

  $("#closeInstallScheduleModal")?.addEventListener("click", closeInstallScheduleModal);
  $("#cancelInstallScheduleBtn")?.addEventListener("click", closeInstallScheduleModal);
  el.addEventListener("click", (e) => {
    if (e.target === el) closeInstallScheduleModal();
  });

  $("#installScheduleForm")?.addEventListener("input", () => {
    document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  });
  $("#installScheduleForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveInstallSchedule();
  });

  $("#clearInstallScheduleBtn")?.addEventListener("click", async () => {
    const positionId = Number($("#installSchedulePosition").value) || draft?.positionId;
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

function fillPositionOptions(selectedId) {
  const select = $("#installSchedulePosition");
  const candidates = state.positions.filter(
    (p) => isInstallRelevant(p) || p.positionStatus === "Готово до встановлення" || p.progress >= 80
  );
  select.innerHTML = candidates
    .map((p) => {
      const label = `${escapeHtml(p.orderNumber)} — ${escapeHtml(p.item)} (${escapeHtml(p.object || "")})`;
      return `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${label}</option>`;
    })
    .join("");
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

  const isoStart = options.isoDay || (position?.installDate ? isoFromUa(position.installDate) : toIsoDate(new Date()));
  const range = position ? getInstallDayRange(position) : null;
  const isoEnd = range ? toIsoDate(range.end) : isoStart;

  draft = { positionId: position?.id ?? null };

  fillPositionOptions(position?.id ?? options.positionId);
  fillInstallersList();
  fillPresets();

  $("#installScheduleDateStart").value = isoStart;
  $("#installScheduleDateEnd").value = isoEnd;
  $("#installScheduleInstaller").value = position?.installResponsible || "";

  $("#installScheduleTitle").textContent = position?.installDate ? "Редагувати монтаж" : "Запланувати монтаж";
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
    positionId: Number($("#installSchedulePosition").value) || draft?.positionId || null,
    isoStart: $("#installScheduleDateStart").value,
    isoEnd: $("#installScheduleDateEnd").value,
    installer: $("#installScheduleInstaller").value
  };
}

export function restoreInstallScheduleOverlay(saved) {
  if (!saved) return;
  const position = saved.positionId
    ? state.positions.find((p) => p.id === saved.positionId)
    : null;
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
  const positionId = Number($("#installSchedulePosition").value);
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
