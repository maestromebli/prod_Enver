import { api } from "./api.js";
import { runSave } from "./save-flow.js";
import { state } from "./state.js";
import { $ } from "./utils.js";

let onSaved = () => {};

export function setOrderSaveHandler(handler) {
  onSaved = handler;
}

function modal() {
  return $("#orderModal");
}

function showError(message) {
  const el = $("#orderFormError");
  el.textContent = message;
  el.classList.toggle("visible", Boolean(message));
}

function fillSelect(id, options, value) {
  const select = $(id);
  select.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join("");
  if (value) select.value = value;
}

function fillDatalists() {
  const managers = state.directories["Менеджери"] || [];
  $("#managersList").innerHTML = managers.map((m) => `<option value="${m}"></option>`).join("");
}

function syncOrderModalChrome(order = null) {
  const title = $("#orderModalTitle");
  const subtitle = $("#orderModalSubtitle");
  if (!title) return;

  if (!order) {
    title.textContent = "Нове замовлення";
    if (subtitle) {
      subtitle.textContent = "";
      subtitle.hidden = true;
    }
    return;
  }

  title.textContent = order.orderNumber || `Замовлення #${order.id}`;
  if (subtitle) {
    const parts = [order.object, order.client].filter(Boolean);
    subtitle.textContent = parts.join(" · ");
    subtitle.hidden = !parts.length;
  }
}

function syncOrderFormMoreOpen(order = null) {
  const details = $("#orderFormMore");
  if (!details) return;
  if (!order) {
    details.open = false;
    return;
  }
  const hasExtra = Boolean(
    order.startDate?.trim() ||
    order.planDate?.trim() ||
    order.comment?.trim() ||
    (order.priority && order.priority !== "Звичайний")
  );
  details.open = hasExtra;
}

export function openOrderModal(order = null) {
  fillDatalists();
  const statuses = state.directories["Статуси замовлення"] || [];
  const priorities = state.directories["Пріоритети"] || ["Високий", "Звичайний", "Низький"];

  syncOrderModalChrome(order);
  $("#orderId").value = order?.id ?? "";
  $("#orderNumber").value = order?.orderNumber ?? "";
  $("#orderObject").value = order?.object ?? "";
  $("#orderClient").value = order?.client ?? "";
  $("#orderManager").value = order?.manager ?? "";
  $("#orderStartDate").value = order?.startDate ?? "";
  $("#orderPlanDate").value = order?.planDate ?? "";
  $("#orderComment").value = order?.comment ?? "";

  fillSelect("#orderStatus", statuses, order?.status || statuses[0] || "");
  fillSelect("#orderPriority", priorities, order?.priority || "Звичайний");
  syncOrderFormMoreOpen(order);

  $("#deleteOrderBtn").style.display = order ? "inline-flex" : "none";
  showError("");
  modal().classList.add("open");
  modal().setAttribute("aria-hidden", "false");
  $("#orderNumber").focus();
}

export function closeOrderModal() {
  modal().classList.remove("open");
  modal().setAttribute("aria-hidden", "true");
  $("#orderForm").reset();
  showError("");
}

function readForm() {
  return {
    orderNumber: $("#orderNumber").value.trim(),
    object: $("#orderObject").value.trim(),
    client: $("#orderClient").value.trim(),
    manager: $("#orderManager").value.trim(),
    startDate: $("#orderStartDate").value.trim(),
    planDate: $("#orderPlanDate").value.trim(),
    status: $("#orderStatus").value,
    priority: $("#orderPriority").value,
    comment: $("#orderComment").value.trim()
  };
}

export function isOrderModalOpen() {
  return modal()?.classList.contains("open");
}

export function captureOrderModalState() {
  if (!isOrderModalOpen()) return null;
  return {
    id: $("#orderId").value || null,
    ...readForm()
  };
}

export function restoreOrderModalState(saved) {
  if (!saved) return;
  const order = saved.id ? state.orders.find((o) => String(o.id) === String(saved.id)) : null;
  openOrderModal(order);
  $("#orderNumber").value = saved.orderNumber ?? "";
  $("#orderObject").value = saved.object ?? "";
  $("#orderClient").value = saved.client ?? "";
  $("#orderManager").value = saved.manager ?? "";
  $("#orderStartDate").value = saved.startDate ?? "";
  $("#orderPlanDate").value = saved.planDate ?? "";
  if (saved.status) $("#orderStatus").value = saved.status;
  if (saved.priority) $("#orderPriority").value = saved.priority;
  $("#orderComment").value = saved.comment ?? "";
  if (!saved.id) $("#orderId").value = "";
  syncOrderModalChrome(order);
  syncOrderFormMoreOpen(order || saved);
}

async function saveOrder(event) {
  event.preventDefault();
  showError("");

  const id = $("#orderId").value;
  const body = readForm();
  const submitBtn = $("#orderForm")?.querySelector('[type="submit"]');

  await runSave(id ? "Замовлення" : "Нове замовлення", {
    submitEl: submitBtn,
    saveFn: () => (id ? api.updateOrder(id, body) : api.createOrder(body)),
    successMessage: id ? "Замовлення збережено" : "Замовлення створено",
    onSuccess: async () => {
      closeOrderModal();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

async function deleteOrder() {
  const id = $("#orderId").value;
  if (!id) return;

  const order = state.orders.find((o) => String(o.id) === String(id));
  const label = order?.orderNumber || id;
  if (
    !window.confirm(`Видалити замовлення «${label}»? Позиції залишаться в системі без прив’язки.`)
  ) {
    return;
  }

  await runSave("Замовлення", {
    saveFn: () => api.deleteOrder(id),
    successMessage: "Замовлення видалено",
    onSuccess: async () => {
      closeOrderModal();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

export function initOrderModal() {
  $("#orderForm")?.addEventListener("input", () => {
    document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  });
  $("#orderForm").addEventListener("submit", saveOrder);
  $("#closeOrderModal").addEventListener("click", closeOrderModal);
  $("#cancelOrderBtn").addEventListener("click", closeOrderModal);
  $("#deleteOrderBtn").addEventListener("click", deleteOrder);

  modal().addEventListener("click", (e) => {
    if (e.target === modal()) closeOrderModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal().classList.contains("open")) {
      closeOrderModal();
    }
  });
}
