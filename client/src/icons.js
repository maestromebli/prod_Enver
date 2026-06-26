/**
 * Єдиний набір SVG-іконок для менеджерського та операторського UI.
 */

const SVG_BASE =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"';

const ICON_PATHS = {
  overview:
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  orders: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.7L12 12.5l8.7-4.8M12 22V12.5"/>',
  attention:
    '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
  production:
    '<path d="M2 20h20"/><path d="M5 20V10l4-3v13"/><path d="M9 20V6l6-3v17"/><path d="M15 20V9l4-2v13"/>',
  constructor:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  procurement:
    '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  install: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/>',
  clipboard:
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  barcode:
    '<path d="M3 5v14"/><path d="M8 5v14"/><path d="M12 5v14"/><path d="M17 5v14"/><path d="M21 5v14"/>',
  cube3d:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7.7L12 12.5l8.7-4.8M12 22V12.5"/>',
  alertTriangle:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  dot: '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  cut: '<path d="M6 3l3 7-3 11M18 3l-3 7 3 11"/>',
  edge: '<rect x="3" y="8" width="18" height="8" rx="1"/>',
  drill: '<circle cx="12" cy="12" r="3"/>',
  assembly: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/>',
  pack: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.7L12 12.5l8.7-4.8M12 22V12.5"/>'
};

const NAV_TAB_ICONS = {
  Огляд: "overview",
  Замовлення: "orders",
  "Потребує уваги": "attention",
  "Цех зараз": "production",
  Конструктори: "constructor",
  Закупівля: "procurement",
  Встановлення: "install",
  "Історія змін": "history"
};

/** @param {string} name @param {string} [className] */
export function iconSvg(name, className = "enver-icon") {
  const paths = ICON_PATHS[name];
  if (!paths) return "";
  const cls = className ? ` class="${className}"` : "";
  return `<svg${cls} ${SVG_BASE}>${paths}</svg>`;
}

/** @param {string} tab */
export function navIconSvg(tab) {
  const key = NAV_TAB_ICONS[tab] || "dot";
  return iconSvg(key, "enver-icon enver-icon--nav");
}

/** @param {string} type */
export function stageIconSvg(type) {
  return iconSvg(type in ICON_PATHS ? type : "cut", "enver-icon enver-icon--stage");
}

/** @param {"search"|"clipboard"|"cube3d"} kind */
export function emptyStateIcon(kind) {
  return iconSvg(kind, "enver-icon enver-icon--empty");
}
