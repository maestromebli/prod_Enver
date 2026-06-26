import { api } from "./api.js";
import { clearOrderDetailViewState } from "./order-detail.js";
import { runSave } from "./save-flow.js";
import { state } from "./state.js";
import { $, fillSelect, showFormError } from "./utils.js";

let onSaved = () => {};

export function setOrderSaveHandler(handler) {
  onSaved = handler;
}

function modal() {
  return $("#orderModal");
}

function showError(message) {
  showFormError("#orderFormError", message);
}

function fillDatalists() {
  const managers = state.directories["Менеджери"] || [];
  $("#managersList").innerHTML = managers.map((m) => `<option value="${m}"></option>`).join("");
}

function syncOrderModalChrome(order = null) {
  const title = $("#orderModalTitle");
  const subtitle = $("#orderModalSubtitle");
  const submit = $("#orderSubmitBtn");
  if (!title) return;

  if (!order) {
    title.textContent = "Нове замовлення";
    if (subtitle) {
      subtitle.textContent =
        "Мінімум: номер і об'єкт. Кожен рядок позицій — окреме завдання для конструктора.";
      subtitle.hidden = false;
    }
    if (submit) submit.textContent = "Створити";
    return;
  }

  title.textContent = order.orderNumber || `Замовлення #${order.id}`;
  if (subtitle) {
    const parts = [order.object, order.client].filter(Boolean);
    subtitle.textContent = parts.join(" · ") || "Редагування";
    subtitle.hidden = false;
  }
  if (submit) submit.textContent = "Зберегти";
}

function syncOrderFormMoreOpen(order = null) {
  const details = $("#orderFormMore");
  if (!details) return;
  if (!order) {
    details.open = false;
    return;
  }
  const hasExtra = Boolean(
    order.manager?.trim() ||
    order.startDate?.trim() ||
    order.planDate?.trim() ||
    order.comment?.trim() ||
    order.defaultDeliveryAddress?.trim() ||
    (order.priority && order.priority !== "Звичайний")
  );
  details.open = hasExtra;
}

function syncSubItemsBlock(isNew) {
  const block = $("#orderSubItemsBlock");
  const singleBlock = $("#orderSinglePositionBlock");
  const statusField = $("#orderStatusField");
  if (block) block.hidden = !isNew;
  if (singleBlock) singleBlock.hidden = !isNew;
  if (statusField) statusField.hidden = isNew;
  if (isNew) {
    const ta = $("#orderSubItemsText");
    if (ta && !ta.value.trim()) ta.value = "";
    const single = $("#orderCreateSinglePosition");
    if (single) single.checked = false;
  }
}

function readSubItemsFromDom() {
  const text = $("#orderSubItemsText")?.value || "";
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function openOrderModal(order = null) {
  fillDatalists();
  const statuses = state.directories["Статуси замовлення"] || [];
  const priorities = state.directories["Пріоритети"] || ["Високий", "Звичайний", "Низький"];

  syncOrderModalChrome(order);
  syncSubItemsBlock(!order);
  $("#orderId").value = order?.id ?? "";
  $("#orderNumber").value = order?.orderNumber ?? "";
  $("#orderObject").value = order?.object ?? "";
  $("#orderClient").value = order?.client ?? "";
  $("#orderDeliveryAddress").value = order?.defaultDeliveryAddress ?? "";
  $("#orderManager").value = order?.manager ?? "";
  $("#orderStartDate").value = order?.startDate ?? "";
  $("#orderPlanDate").value = order?.planDate ?? "";
  $("#orderComment").value = order?.comment ?? "";
  $("#orderSubItemsText").value = "";
  $("#orderCreateSinglePosition").checked = false;

  fillSelect("#orderStatus", statuses, order?.status || statuses[0] || "");
  fillSelect("#orderPriority", priorities, order?.priority || "Звичайний");
  syncOrderFormMoreOpen(order);

  $("#deleteOrderBtn").style.display = order ? "inline-flex" : "none";
  showError("");
  modal().classList.add("open");
  modal().setAttribute("aria-hidden", "false");
  $("#orderObject").focus();
}

export function closeOrderModal() {
  modal().classList.remove("open");
  modal().setAttribute("aria-hidden", "true");
  $("#orderForm").reset();
  $("#orderSubItemsText").value = "";
  $("#orderCreateSinglePosition").checked = false;
  showError("");
}

function readForm() {
  const statuses = state.directories["Статуси замовлення"] || [];
  const isNew = !$("#orderId").value;
  const body = {
    orderNumber: $("#orderNumber").value.trim(),
    object: $("#orderObject").value.trim(),
    client: $("#orderClient").value.trim(),
    defaultDeliveryAddress: $("#orderDeliveryAddress")?.value.trim() ?? "",
    manager: $("#orderManager").value.trim(),
    startDate: $("#orderStartDate").value.trim(),
    planDate: $("#orderPlanDate").value.trim(),
    status: isNew ? statuses[0] || "Новий" : $("#orderStatus").value,
    priority: $("#orderPriority").value,
    comment: $("#orderComment").value.trim()
  };
  if (isNew) {
    body.subItems = readSubItemsFromDom();
    body.createRootPosition = Boolean($("#orderCreateSinglePosition")?.checked);
  }
  return body;
}

export function isOrderModalOpen() {
  return modal()?.classList.contains("open");
}

export function captureOrderModalState() {
  if (!isOrderModalOpen()) return null;
  return {
    id: $("#orderId").value || null,
    ...readForm(),
    subItems: readSubItemsFromDom(),
    createRootPosition: Boolean($("#orderCreateSinglePosition")?.checked)
  };
}

export function restoreOrderModalState(saved) {
  if (!saved) return;
  const order = saved.id ? state.orders.find((o) => String(o.id) === String(saved.id)) : null;
  openOrderModal(order);
  $("#orderNumber").value = saved.orderNumber ?? "";
  $("#orderObject").value = saved.object ?? "";
  $("#orderClient").value = saved.client ?? "";
  if (saved.defaultDeliveryAddress != null) {
    $("#orderDeliveryAddress").value = saved.defaultDeliveryAddress;
  }
  $("#orderManager").value = saved.manager ?? "";
  $("#orderStartDate").value = saved.startDate ?? "";
  $("#orderPlanDate").value = saved.planDate ?? "";
  if (saved.status) $("#orderStatus").value = saved.status;
  if (saved.priority) $("#orderPriority").value = saved.priority;
  $("#orderComment").value = saved.comment ?? "";
  if (!saved.id) {
    $("#orderId").value = "";
    if (Array.isArray(saved.subItems) && saved.subItems.length) {
      $("#orderSubItemsText").value = saved.subItems.join("\n");
    }
    if (saved.createRootPosition) {
      $("#orderCreateSinglePosition").checked = true;
    }
  }
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
    onSuccess: async (created) => {
      closeOrderModal();
      if (!id && created?.id) {
        const { upsertOrder, upsertPosition } = await import("./data-sync.js");
        upsertOrder(created);
        if (Array.isArray(created.positions)) {
          for (const p of created.positions) upsertPosition(p);
        }
        state.selectedOrderId = created.id;
        const work = created.workPositions || [];
        state.ordersView.detailTab = work[0]?.id ? `pos-${work[0].id}` : "overview";
      }
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
    !window.confirm(
      `Видалити замовлення «${label}» разом із усіма позиціями та файлами? Цю дію не можна скасувати.`
    )
  ) {
    return;
  }

  await runSave("Замовлення", {
    saveFn: () => api.deleteOrder(id),
    successMessage: "Замовлення видалено",
    onSuccess: async () => {
      const { removeOrder, removePosition } = await import("./data-sync.js");
      const orderNumber = order?.orderNumber;
      state.positions
        .filter((p) => p.orderId === Number(id) || (orderNumber && p.orderNumber === orderNumber))
        .forEach((p) => removePosition(p.id));
      removeOrder(Number(id));
      if (state.selectedOrderId === Number(id)) {
        state.selectedOrderId = null;
        clearOrderDetailViewState();
      }
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
