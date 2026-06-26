const TOUR_STORAGE_KEY = "enver_quick_tour_step";

const TOUR_STEPS = [
  {
    tab: "Замовлення",
    title: "Крок 1 з 3",
    hint: "Створи або відкрий замовлення",
    focusSelector: "#toolbarNewOrderBtn"
  },
  {
    tab: "Замовлення",
    ordersDisplayMode: "positions",
    title: "Крок 2 з 3",
    hint: "Додай позицію з відповідальними",
    focusSelector: "#toolbarNewPositionBtn"
  },
  {
    tab: "Цех зараз",
    title: "Крок 3 з 3",
    hint: "Проведи позицію по етапах до монтажу",
    focusSelector: "#pfRefreshBtn"
  }
];

function readStepIndex() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY);
    if (raw == null) return null;
    const idx = Number(raw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= TOUR_STEPS.length) return null;
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
  const idx = readStepIndex();
  if (idx == null) return null;
  return { ...TOUR_STEPS[idx], index: idx, total: TOUR_STEPS.length };
}

export function nextTourStep() {
  const step = getTourStep();
  if (!step) return null;
  const nextIndex = step.index + 1;
  if (nextIndex >= TOUR_STEPS.length) {
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
