import { renderFileUploadZone, bindFileUploadZone, readFileAsBase64 } from "../file-upload-zone.js";
import { ORDER_3D_UPLOAD_EXT, ORDER_3D_MAX_BYTES } from "@enver/shared/production/order-3d.js";
import { canUpload3DAsset } from "./order-3d-permissions.js";

export function renderOrder3DUploadZone() {
  if (!canUpload3DAsset()) {
    return `<p class="enver-meta">Завантаження 3D-моделі доступне конструктору або менеджеру.</p>`;
  }

  return `
    <div class="order-3d-upload card" data-order-3d-upload-wrap>
      ${renderOrderUploadZoneInner()}
    </div>`;
}

function renderOrderUploadZoneInner() {
  return renderFileUploadZone({
    zoneAttr: "data-order-3d-upload",
    inputAttr: "data-order-3d-upload-input",
    hint: "Завантажте файл БАЗІС .b3d — система сама створить web-модель .glb",
    formats: "Підтримується також ручне завантаження .glb",
    accept: ORDER_3D_UPLOAD_EXT.join(",")
  });
}

export function bindOrder3DUploadZone(root, { onUpload }) {
  if (!canUpload3DAsset()) return;
  const wrap = root.querySelector("[data-order-3d-upload-wrap]") || root;
  bindFileUploadZone(wrap, {
    zoneSelector: "[data-order-3d-upload]",
    inputSelector: "[data-order-3d-upload-input]",
    accept: ORDER_3D_UPLOAD_EXT,
    maxBytes: ORDER_3D_MAX_BYTES,
    multiple: false,
    onFile: async (file) => {
      const dataBase64 = await readFileAsBase64(file);
      await onUpload?.({
        fileName: file.name,
        mime: file.type || "application/octet-stream",
        dataBase64
      });
    },
    onReject: (reason) => {
      import("../toast.js").then(({ toastError }) => toastError(reason));
    }
  });
}
