import { filteredPositions } from "./render.js";
import { resolveObjectNameFromOrders } from "@enver/shared/production/object-display.js";
import { state } from "./state.js";
import { toastSuccess } from "./toast.js";

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function exportPositionsCsv() {
  const rows = filteredPositions();
  const headers = [
    "ID",
    "Замовлення",
    "Об'єкт",
    "Виріб",
    "Статус",
    "Прогрес %",
    "Прострочка",
    "Порізка",
    "Крайкування",
    "Присадка",
    "Збірка"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((p) =>
      [
        p.id,
        p.orderNumber,
        resolveObjectNameFromOrders(p, state.orders),
        p.item,
        p.positionStatus,
        p.progress,
        p.overdueDays,
        p.cuttingStatus,
        p.edgingStatus,
        p.drillingStatus,
        p.assemblyStatus
      ]
        .map(csvEscape)
        .join(",")
    )
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `enver-positions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toastSuccess(`Експортовано ${rows.length} позицій`);
}
