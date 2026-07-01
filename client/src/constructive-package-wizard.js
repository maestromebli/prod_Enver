import { escapeHtml } from "./utils.js";
import {
  isPackageParsingStatus,
  isPackageNotParsedStatus
} from "@enver/shared/production/constructive-package.js";

/** Wizard пакета конструктива: один активний крок, AI/закупівля — після перевірки. */
export const PACKAGE_WIZARD_STEPS = [
  { key: "upload", label: "Завантажити" },
  { key: "parse", label: "Розібрати" },
  { key: "verify", label: "Перевірити" },
  { key: "handoff", label: "Передати" }
];

/**
 * Індекс активного кроку wizard за станом пакета.
 * @param {object|null} detail
 * @returns {number}
 */
export function resolvePackageWizardStep(detail) {
  const pkg = detail?.package;
  const hasFiles = Boolean(detail?.files?.length);

  if (!pkg || !hasFiles) return 0;

  const status = String(pkg.status || "").trim();
  if (isPackageParsingStatus(status)) return 1;
  if (isPackageNotParsedStatus(status)) return 0;
  if (["parsed", "needs_review", "rejected"].includes(status)) return 2;
  return 3;
}

export function renderPackageWizardStepper(detail, { selectedStep = null } = {}) {
  const current = resolvePackageWizardStep(detail);
  const active = selectedStep ?? current;

  const steps = PACKAGE_WIZARD_STEPS.map((step, index) => {
    let cls = "cp-wizard-step";
    if (index < current) cls += " is-done";
    if (index === active) cls += " is-active";
    if (index === current && isPackageParsingStatus(detail?.package?.status)) {
      cls += " is-parsing";
    }
    const clickable = index <= current;
    const tag = clickable
      ? `<button type="button" class="${cls}" data-cp-wizard-go="${index}" aria-current="${index === active ? "step" : "false"}">${escapeHtml(step.label)}</button>`
      : `<span class="${cls}" aria-disabled="true">${escapeHtml(step.label)}</span>`;
    const arrow =
      index < PACKAGE_WIZARD_STEPS.length - 1
        ? `<span class="cp-wizard-arrow" aria-hidden="true">→</span>`
        : "";
    return `${tag}${arrow}`;
  }).join("");

  return `<nav class="cp-wizard-stepper" aria-label="Етапи пакета конструктива" data-cp-wizard-stepper>${steps}</nav>`;
}

export function wrapWizardPanel(stepIndex, stepKey, innerHtml, { current, selected }) {
  const isActive = stepIndex === selected;
  const isDone = stepIndex < current;
  return `<div class="cp-wizard-panel ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}" data-cp-wizard-panel="${stepKey}" ${isActive ? "" : "hidden"}>${innerHtml}</div>`;
}

export function applyPackageWizardUi(block, detail, selectedStep = null) {
  if (!block) return;
  const current = resolvePackageWizardStep(detail);
  const selected = selectedStep ?? current;

  block.dataset.cpWizardStep = String(selected);

  block.querySelectorAll("[data-cp-wizard-panel]").forEach((panel) => {
    const key = panel.dataset.cpWizardPanel;
    const index = PACKAGE_WIZARD_STEPS.findIndex((s) => s.key === key);
    const isActive = index === selected;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
    panel.classList.toggle("is-done", index < current);
  });

  block.querySelectorAll("[data-cp-wizard-go]").forEach((btn) => {
    const index = Number(btn.dataset.cpWizardGo);
    btn.classList.toggle("is-active", index === selected);
    btn.classList.toggle("is-done", index < current);
    btn.setAttribute("aria-current", index === selected ? "step" : "false");
  });
}

export function bindPackageWizard(root, { getDetail = () => null } = {}) {
  const block = root?.querySelector?.(".constructive-package-block.cp-wizard") || root;
  if (!block) return;

  block.querySelectorAll("[data-cp-wizard-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.cpWizardGo);
      const detail = getDetail();
      const current = resolvePackageWizardStep(detail);
      if (!Number.isFinite(step) || step > current) return;
      applyPackageWizardUi(block, detail, step);
    });
  });
}
