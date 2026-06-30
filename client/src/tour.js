import {
  OVERVIEW_TAB,
  ATTENTION_TAB,
  PRODUCTION_FLOOR_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB
} from "./constants.js";
import { canEditOrders, canViewConstructorDesk, canViewProcurement } from "./auth.js";

const TOUR_STORAGE_KEY = "enver_quick_tour_step";

/** @typedef {{ id: string, tab: string, hint: string, focusSelector?: string, ordersDisplayMode?: string, visible?: () => boolean }} TourStepDef */

/** @type {TourStepDef[]} */
const TOUR_STEP_DEFS = [
  {
    id: "overview",
    tab: OVERVIEW_TAB,
    hint: "Огляд показників і швидкі переходи по системі",
    focusSelector: ".dash-quick-nav"
  },
  {
    id: "orders",
    tab: "Замовлення",
    hint: "Створіть або відкрийте замовлення — тут весь реєстр проєктів",
    focusSelector: "#toolbarNewOrderBtn",
    visible: () => canEditOrders()
  },
  {
    id: "orders-browse",
    tab: "Замовлення",
    hint: "Відкрийте картку замовлення — позиції, конструктив і етапи",
    focusSelector: ".orders-grid",
    visible: () => !canEditOrders()
  },
  {
    id: "attention",
    tab: ATTENTION_TAB,
    hint: "Блокери, проблеми та рекомендовані наступні кроки",
    focusSelector: ".attention-hero"
  },
  {
    id: "floor",
    tab: PRODUCTION_FLOOR_TAB,
    hint: "Черги, активні сесії операторів і передача між етапами",
    focusSelector: "#pfRefreshBtn"
  },
  {
    id: "constructor",
    tab: CONSTRUCTOR_DESK_TAB,
    hint: "Призначені позиції, пакети конструктива та передача в цех",
    focusSelector: ".cd-hero",
    visible: () => canViewConstructorDesk()
  },
  {
    id: "procurement",
    tab: PROCUREMENT_TAB,
    hint: "Календар MTO, склад, рекламації та заявки на матеріали",
    focusSelector: ".procurement-mode-bar",
    visible: () => canViewProcurement()
  }
];

export function resolveTourSteps() {
  return TOUR_STEP_DEFS.filter((step) => !step.visible || step.visible());
}

function readStepIndex() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    if (raw == null) return null;
    const idx = Number(raw);
    const total = resolveTourSteps().length;
    if (!Number.isInteger(idx) || idx < 0 || idx >= total) return null;
    return idx;
  } catch {
    return null;
  }
}

function writeStepIndex(index) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, String(index));
  } catch {
    /* ignore */
  }
}

export function stopTour() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function startTour() {
  writeStepIndex(0);
  return getTourStep();
}

export function getTourStep() {
  const steps = resolveTourSteps();
  const idx = readStepIndex();
  if (idx == null || !steps[idx]) return null;
  const step = steps[idx];
  return {
    ...step,
    index: idx,
    total: steps.length,
    title: `Крок ${idx + 1} з ${steps.length}`
  };
}

export function nextTourStep() {
  const step = getTourStep();
  if (!step) return null;
  const nextIndex = step.index + 1;
  if (nextIndex >= resolveTourSteps().length) {
    stopTour();
    return null;
  }
  writeStepIndex(nextIndex);
  return getTourStep();
}

export function renderTourCoach() {
  const step = getTourStep();
  if (!step) return "";
  const isLast = step.index === step.total - 1;
  return `
    <div class="tour-coach" role="status" aria-live="polite">
      <div class="tour-coach-text">
        <strong>${step.title}</strong>
        <span>${step.hint}</span>
      </div>
      <div class="tour-coach-actions">
        <button type="button" class="btn btn-sm" data-tour-stop="1">Зупинити тур</button>
        <button type="button" class="btn btn-primary btn-sm" data-tour-next="1">${
          isLast ? "Завершити" : "Далі"
        }</button>
      </div>
    </div>
  `;
}

export function applyTourHighlights() {
  const step = getTourStep();
  document.querySelectorAll(".tour-target").forEach((el) => el.classList.remove("tour-target"));
  if (!step) return;

  document.querySelectorAll("[data-tab]").forEach((tabBtn) => {
    if (tabBtn.dataset.tab === step.tab) tabBtn.classList.add("tour-target");
  });
  if (step.focusSelector) {
    const target = document.querySelector(step.focusSelector);
    if (target) target.classList.add("tour-target");
  }
}
