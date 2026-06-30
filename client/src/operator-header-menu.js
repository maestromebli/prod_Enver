import { $ } from "./utils.js";

let menuBound = false;

function closeOperatorHeaderMenu() {
  const menu = $("#operatorHeaderMenu");
  const btn = $("#operatorHeaderMenuBtn");
  if (!menu) return;
  menu.hidden = true;
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
  }
}

function toggleOperatorHeaderMenu() {
  const menu = $("#operatorHeaderMenu");
  const btn = $("#operatorHeaderMenuBtn");
  if (!menu || !btn) return;
  const open = menu.hidden;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

export function bindOperatorHeaderMenu() {
  if (menuBound) return;
  menuBound = true;

  $("#operatorHeaderMenuBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOperatorHeaderMenu();
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".operator-header-overflow")) return;
    closeOperatorHeaderMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOperatorHeaderMenu();
  });

  $("#operatorHeaderMenu")?.addEventListener("click", (e) => {
    if (e.target.closest(".operator-header-menu-item")) {
      closeOperatorHeaderMenu();
    }
  });
}

export function syncOperatorHeaderMenu() {
  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) logoutBtn.hidden = false;
}
