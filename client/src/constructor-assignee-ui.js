import {
  normalizePersonName,
  parseConstructorAssigneeValue
} from "@enver/shared/production/constructor-assignees.js";
import { escapeHtml } from "./utils.js";

export { parseConstructorAssigneeValue };

export function constructorAssigneeKey(entry) {
  if (entry?.id != null) return `u:${entry.id}`;
  return `n:${String(entry?.name || "").trim()}`;
}

export function selectedConstructorAssigneeValue(position, entry) {
  const userId = position.constructorUserId != null ? Number(position.constructorUserId) : null;
  const entryId = entry.id != null ? Number(entry.id) : null;
  if (entryId != null && userId != null && userId === entryId) {
    return constructorAssigneeKey(entry);
  }
  const assignedName = normalizePersonName(
    position.constructorUserName || position.constructor || ""
  );
  if (!position.constructorUserId && assignedName === normalizePersonName(entry.name)) {
    return constructorAssigneeKey(entry);
  }
  return null;
}

export function constructorOptionsForPosition(position, constructors = []) {
  const list = [...constructors];
  if (!position.constructorUserId && String(position.constructor || "").trim()) {
    const name = position.constructor.trim();
    if (!list.some((u) => normalizePersonName(u.name) === normalizePersonName(name))) {
      list.unshift({ id: null, name });
    }
  } else if (
    position.constructorUserId &&
    !list.some((user) => user.id === position.constructorUserId)
  ) {
    list.unshift({
      id: position.constructorUserId,
      name: position.constructorUserName || position.constructor || `#${position.constructorUserId}`
    });
  }
  return list;
}

export function renderConstructorSelectOptions(position, constructors = []) {
  const options = constructorOptionsForPosition(position, constructors);
  if (!options.length) {
    return `<option value="" disabled>Додайте імена в довідник «Конструктори»</option>`;
  }
  return options
    .map((entry) => {
      const value = constructorAssigneeKey(entry);
      const selected = selectedConstructorAssigneeValue(position, entry) === value;
      const hint = entry.id == null ? " (без облікового запису)" : "";
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(entry.name)}${hint}</option>`;
    })
    .join("");
}
