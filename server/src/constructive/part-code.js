import crypto from "crypto";

/** Нормалізує номер замовлення для штрихкоду. */
export function normalizeOrderCode(orderNumber) {
  return (
    String(orderNumber || "ORD")
      .replace(/\s+/g, "")
      .replace(/[^\w-]/g, "")
      .slice(0, 24) || "ORD"
  );
}

/** Код деталі: E30-B1-21 */
export function buildPartCode({ orderNumber, blockCode, partNo }) {
  const order = normalizeOrderCode(orderNumber);
  const block = String(blockCode || "").trim();
  const no = String(partNo || "").trim();
  if (block && no) return `${order}-${block}-${no}`;
  if (no) return `${order}-${no}`;
  return `${order}-PART`;
}

/**
 * Штрихкод: ENVER-{orderNumber}-{positionId}-{packageId}-{partNo}
 * Якщо part_no не унікальний — додаємо block_code.
 */
export function buildBarcodeValue({
  orderNumber,
  positionId,
  packageId,
  partNo,
  blockCode,
  suffix = ""
}) {
  const order = normalizeOrderCode(orderNumber);
  const base = blockCode
    ? `ENVER-${order}-${positionId}-${packageId}-${blockCode}-${partNo}`
    : `ENVER-${order}-${positionId}-${packageId}-${partNo}`;
  return suffix ? `${base}-${suffix}` : base;
}

export function computeChecksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Унікальність barcode при qty>1 — instance suffix. */
export function buildInstanceBarcode(baseBarcode, instanceNo) {
  return `${baseBarcode}-I${instanceNo}`;
}
