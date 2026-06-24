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

/** Людський текст замість технічних повідомлень API / валідації. */
export function humanizeUserMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return "Щось пішло не так. Спробуйте ще раз.";

  const rules = [
    [/validation failed|required/i, "Заповніть обовʼязкові поля."],
    [/unauthorized|401/i, "Сесія закінчилась — увійдіть знову."],
    [/forbidden|403/i, "Недостатньо прав для цієї дії."],
    [/not found|404/i, "Запис не знайдено."],
    [/network|failed to fetch/i, "Немає звʼязку з сервером. Перевірте підключення."],
    [/name required/i, "Вкажіть назву позиції."],
    [/order.?number/i, "Вкажіть номер замовлення."],
    [/constructive|конструктив/i, "Потрібно завантажити конструктив."],
    [/timeout/i, "Сервер не відповів вчасно — спробуйте ще раз."]
  ];

  for (const [pattern, text] of rules) {
    if (pattern.test(raw)) return text;
  }

  if (raw.length > 120 || /[{[\]}/\\]/.test(raw)) {
    return "Не вдалося виконати дію. Перевірте дані та спробуйте знову.";
  }

  return raw;
}

export function statusClass(status) {
  return STATUS_CLASS[status] || "gray";
}

export function badge(status) {
  const text = escapeHtml(status || "—");
  const cls = statusClass(status);
  return `<span class="badge enver-badge enver-badge-${cls === "green" ? "success" : cls === "red" ? "danger" : cls === "yellow" || cls === "orange" ? "warning" : cls === "blue" ? "info" : "neutral"} ${cls}">${text}</span>`;
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

export function progressRing(value, { size = 56 } = {}) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
  return `
    <div class="progress-ring" style="width:${size}px;height:${size}px" aria-label="${v}%">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="progress-ring-bg"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="progress-ring-fill"
          style="stroke-dasharray:${c};stroke-dashoffset:${offset}"/>
      </svg>
      <span class="progress-ring-label">${v}%</span>
    </div>`;
}

export function overdue(value) {
  if (!value) return `<span class="muted">0</span>`;
  if (value > 0) return `<span class="overdue">+${value}</span>`;
  return `<span class="overdue">${value}</span>`;
}

export function showFormError(selectorOrEl, message) {
  const el = typeof selectorOrEl === "string" ? $(selectorOrEl) : selectorOrEl;
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("visible", Boolean(message));
}

export function fillSelect(target, options, value, { escapeOptions = true } = {}) {
  const select = typeof target === "string" ? $(target) : target;
  if (!select) return;
  select.innerHTML = options
    .map((o) => {
      const v = escapeOptions ? escapeHtml(o) : o;
      return `<option value="${v}">${v}</option>`;
    })
    .join("");
  if (value !== undefined && value !== "") select.value = value;
}
