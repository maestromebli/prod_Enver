import {
  CONSTRUCTORS_DIRECTORY_KEY,
  getDirectoryList
} from "@enver/shared/production/directories.js";
import {
  mergeConstructorAssignees,
  parseConstructorAssigneeValue
} from "@enver/shared/production/constructor-assignees.js";
import { renderConstructorSelectOptions } from "./constructor-assignee-ui.js";
import { api } from "./api.js";
import { canEditPositions, canManageConstructorDesk } from "./auth.js";
import { runSave } from "./save-flow.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { toastError } from "./toast.js";

function directoryNames(key) {
  return getDirectoryList(state.directories, key);
}

async function loadConstructorAssignees() {
  try {
    const dirs = await api.getDirectories();
    state.directories = { ...state.directories, ...dirs };
  } catch {
    /* довідник уже в state */
  }
  const fromApi = canManageConstructorDesk() ? await api.getConstructorDeskConstructors() : [];
  return mergeConstructorAssignees(fromApi, directoryNames(CONSTRUCTORS_DIRECTORY_KEY));
}

function needsAssemblerField(position) {
  const stage = position.currentStage || "constructor";
  return (
    (stage === "drilling" || stage === "assembly") &&
    !String(position.assemblyResponsible || "").trim()
  );
}

export function shouldShowResponsiblesPanel(position) {
  if (!position?.id) return false;
  if (canManageConstructorDesk()) return true;
  if (canEditPositions() && needsAssemblerField(position)) return true;
  return false;
}

export function renderPositionResponsiblesPanel(position, constructors = []) {
  if (!shouldShowResponsiblesPanel(position)) return "";

  const canAssignConstructor = canManageConstructorDesk();
  const canAssignAssembler = canEditPositions();
  const showAssembler =
    canAssignAssembler && (needsAssemblerField(position) || position.assemblyResponsible);

  const constructorBlock = canAssignConstructor
    ? `<div class="form-field span-2">
        <label for="prConstructor-${position.id}">Конструктор *</label>
        <select id="prConstructor-${position.id}" data-pr-constructor="${position.id}">
          <option value="">— оберіть конструктора —</option>
          ${renderConstructorSelectOptions(position, constructors)}
        </select>
      </div>
      <div class="form-field">
        <label for="prDue-${position.id}">Дедлайн</label>
        <input type="datetime-local" id="prDue-${position.id}" value="${position.constructorDueAt ? position.constructorDueAt.slice(0, 16) : ""}" />
      </div>
      <div class="form-field">
        <label for="prHours-${position.id}">Оцінка, год</label>
        <input type="number" id="prHours-${position.id}" min="0" step="0.5" placeholder="год" value="${position.constructorEstimatedHours ?? ""}" />
      </div>`
    : "";

  const assemblerBlock =
    showAssembler && canAssignAssembler
      ? `<div class="form-field span-2">
          <label for="prAssembler-${position.id}">Збирач</label>
          <input id="prAssembler-${position.id}" list="prAssemblersList-${position.id}" value="${escapeHtml(position.assemblyResponsible || "")}" placeholder="Ім'я з довідника «Збирачі»" />
          <datalist id="prAssemblersList-${position.id}">${directoryNames("Збирачі")
            .map((n) => `<option value="${escapeHtml(n)}"></option>`)
            .join("")}</datalist>
        </div>`
      : "";

  if (!constructorBlock && !assemblerBlock) return "";

  return `
    <section class="position-responsibles-panel card" data-position-responsibles="${position.id}" id="positionResponsibles-${position.id}">
      <h3 class="enver-section-title">Відповідальні</h3>
      <p class="field-hint">Призначте конструктора та збирача для цієї позиції.</p>
      <div class="form-grid pr-assign-grid">
        ${constructorBlock}
        ${assemblerBlock}
      </div>
      <div class="pr-form-actions">
        ${
          canAssignConstructor
            ? `<button type="button" class="btn btn-primary btn-sm" data-pr-save-constructor="${position.id}">Зберегти конструктора</button>`
            : ""
        }
        ${
          showAssembler && canAssignAssembler
            ? `<button type="button" class="btn btn-sm" data-pr-save-assembler="${position.id}">Зберегти збирача</button>`
            : ""
        }
      </div>
    </section>`;
}

export function bindPositionResponsiblesPanel(root, position, { onSaved } = {}) {
  const panel = root.querySelector(`[data-position-responsibles="${position.id}"]`);
  if (!panel) return;

  panel
    .querySelector(`[data-pr-save-constructor="${position.id}"]`)
    ?.addEventListener("click", async () => {
      const assignment = parseConstructorAssigneeValue(
        document.getElementById(`prConstructor-${position.id}`)?.value
      );
      if (!assignment.constructorUserId && !assignment.constructorName) {
        toastError("Оберіть конструктора зі списку");
        return;
      }
      const dueRaw = document.getElementById(`prDue-${position.id}`)?.value;
      const hoursRaw = document.getElementById(`prHours-${position.id}`)?.value;
      await runSave("Призначення конструктора", {
        saveFn: () =>
          api.assignConstructorDesk(position.id, {
            ...assignment,
            constructorDueAt: dueRaw ? new Date(dueRaw).toISOString() : null,
            constructorEstimatedHours: hoursRaw ? Number(hoursRaw) : null
          }),
        successMessage: "Конструктора призначено",
        onSuccess: async (result) => {
          const { applyConstructorAssignmentResult, syncWorkflowViews } =
            await import("./data-sync.js");
          applyConstructorAssignmentResult(result);
          await syncWorkflowViews();
          await onSaved?.();
        }
      }).catch(() => {});
    });

  panel
    .querySelector(`[data-pr-save-assembler="${position.id}"]`)
    ?.addEventListener("click", async () => {
      const assemblyResponsible =
        document.getElementById(`prAssembler-${position.id}`)?.value?.trim() || "";
      if (!assemblyResponsible) {
        toastError("Вкажіть збирача");
        return;
      }
      await runSave("Збирач", {
        saveFn: () => api.updatePosition(position.id, { assemblyResponsible }),
        successMessage: "Збирача збережено",
        onSuccess: async (updated) => {
          const { upsertPosition } = await import("./data-sync.js");
          upsertPosition(updated);
          await onSaved?.();
        }
      }).catch(() => {});
    });
}

export async function loadResponsiblesPanelData() {
  if (!canManageConstructorDesk()) return [];
  return loadConstructorAssignees();
}
