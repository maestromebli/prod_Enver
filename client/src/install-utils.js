import { formatDayRange, getInstallDayRange } from "./install-calendar-days.js";

export const READY_STATUS = "Готово до встановлення";
export const ON_INSTALL_STATUS = "На встановленні";

/** Період монтажу для таблиць і карток: «дд.мм.рррр» або «дд.мм.рррр – дд.мм.рррр». */
export function formatInstallPeriod(position) {
  const range = getInstallDayRange(position);
  if (!range) return "—";
  return formatDayRange(range.start, range.end);
}

export function isInstallRelevant(position) {
  return Boolean(
    position.installDate ||
    position.positionStatus === READY_STATUS ||
    position.positionStatus === ON_INSTALL_STATUS
  );
}

/** У модалці можна обрати будь-яку позицію (календар фільтрує відображення окремо). */
export function isInstallScheduleCandidate(position) {
  return Boolean(position?.id);
}

export function positionInstallLabel(position) {
  const parts = [position.orderNumber, position.item].filter(Boolean);
  const title = parts.join(" — ") || `Позиція #${position.id}`;
  const object = String(position.object || "").trim();
  return object ? `${title} (${object})` : title;
}

/** Список для select: кандидати + обрана позиція (навіть якщо не проходить фільтр). */
export function getInstallScheduleCandidates(positions, selectedId) {
  const id = selectedId != null && selectedId !== "" ? Number(selectedId) : null;
  let list = positions.filter(isInstallScheduleCandidate);
  if (id != null && Number.isFinite(id)) {
    const selected = positions.find((p) => p.id === id);
    if (selected && !list.some((p) => p.id === id)) {
      list = [selected, ...list];
    }
  }
  return list.sort((a, b) => {
    const byOrder = (a.orderNumber || "").localeCompare(b.orderNumber || "", "uk");
    if (byOrder !== 0) return byOrder;
    return (a.item || "").localeCompare(b.item || "", "uk") || a.id - b.id;
  });
}
