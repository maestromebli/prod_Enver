const STATUS_CLASS = {
  Передано: "blue",
  "В роботі": "yellow",
  "У виробництві": "yellow",
  Готово: "green",
  "Готово до встановлення": "green",
  Завершено: "green",
  "На паузі": "orange",
  Проблема: "red",
  "Не розпочато": "gray",
  "Не потрібно": "gray",
  Новий: "blue",
  "В работе": "yellow",
  "В производстве": "yellow",
  "Готово к установке": "green",
  Завершён: "green",
  "На паузе": "orange",
  "Не начато": "gray"
};

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function statusClass(status) {
  return STATUS_CLASS[status] || "gray";
}

export function badge(status) {
  const text = escapeHtml(status || "—");
  return `<span class="badge ${statusClass(status)}">${text}</span>`;
}

export function progressBar(value) {
  const v = value || 0;
  return `
    <div class="progress">
      <div class="bar">
        <div class="bar-fill" style="width:${v}%"></div>
      </div>
      <strong>${v}%</strong>
    </div>
  `;
}

export function overdue(value) {
  if (!value) return `<span class="muted">0</span>`;
  if (value > 0) return `<span class="overdue">+${value}</span>`;
  return `<span class="overdue">${value}</span>`;
}
