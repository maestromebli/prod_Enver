import { createFileDropZone } from "./interactions/drag-drop.js";
import { escapeHtml } from "./utils.js";

const boundZones = new WeakMap();

/** @param {File} file */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",")[1] : raw);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Універсальна зона завантаження — один вигляд для конструктива, файлів менеджера тощо.
 *
 * @param {{
 *   zoneId?: string,
 *   zoneAttr?: string,
 *   inputAttr?: string,
 *   hasFiles?: boolean,
 *   title?: string,
 *   hint?: string,
 *   formats?: string,
 *   accept?: string,
 *   fileListHtml?: string,
 *   compact?: boolean,
 * }} [options]
 */
export function renderFileUploadZone({
  zoneId = "",
  zoneAttr = "data-file-upload",
  inputAttr = "data-file-upload-input",
  hasFiles = false,
  title = "Перетягніть файл сюди",
  hint = "або натисніть для вибору",
  formats = "",
  accept = "",
  fileListHtml = "",
  compact = false,
  multiple = false
} = {}) {
  const idAttr = zoneId ? ` id="${escapeHtml(zoneId)}"` : "";
  const compactClass = compact ? " file-upload-zone--compact" : "";
  const state = hasFiles ? "success" : "idle";

  return `
    <div class="file-upload-wrap">
      ${fileListHtml}
      <div
        ${zoneAttr}${idAttr}
        class="constructive-upload-zone file-upload-zone enver-interactive enver-pressable enver-drop-target${compactClass}"
        data-state="${state}"
        tabindex="0"
        aria-label="Завантаження файлу"
      >
        <input type="file" class="enver-file-input-offscreen" ${inputAttr} ${accept ? `accept="${escapeHtml(accept)}"` : ""} ${multiple ? "multiple" : ""} tabindex="-1" aria-hidden="true" />
        <div class="constructive-upload-inner">
          <span class="constructive-upload-icon" aria-hidden="true">${hasFiles ? "✓" : "📎"}</span>
          <p class="constructive-upload-title">${escapeHtml(title)}</p>
          <p class="constructive-upload-hint">${escapeHtml(hint)}</p>
          ${formats ? `<p class="constructive-upload-formats">${escapeHtml(formats)}</p>` : ""}
          <p class="constructive-upload-status" aria-live="polite"></p>
        </div>
      </div>
    </div>`;
}

/**
 * @param {ParentNode} root
 * @param {{
 *   zoneSelector?: string,
 *   inputSelector?: string,
 *   accept?: string[],
 *   maxBytes?: number,
 *   multiple?: boolean,
 *   openPicker?: () => void,
 *   onFile: (file: File) => void | Promise<void>,
 *   onReject?: (reason: string) => void,
 *   onStateChange?: (state: string) => void,
 * }} options
 */
export function bindFileUploadZone(root, options) {
  if (!root) return { destroy() {} };

  const zoneSelector = options.zoneSelector || "[data-file-upload]";
  const inputSelector = options.inputSelector || "[data-file-upload-input]";
  const zone = root.querySelector(zoneSelector);
  const input = root.querySelector(inputSelector);

  boundZones.get(root)?.destroy();

  if (!zone) return { destroy() {} };

  const ctl = createFileDropZone(zone, {
    inputEl: input,
    accept: options.accept,
    maxBytes: options.maxBytes,
    multiple: options.multiple,
    openPicker: options.openPicker,
    onFile: options.onFile,
    onReject: options.onReject,
    onStateChange: options.onStateChange
  });

  boundZones.set(root, ctl);
  return ctl;
}

export function destroyFileUploadZone(root) {
  boundZones.get(root)?.destroy();
  boundZones.delete(root);
}
