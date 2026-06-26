import { escapeHtml } from "./utils.js";

function isImageMime(mime = "") {
  return String(mime).startsWith("image/");
}

function isPdfMime(mime = "", name = "") {
  return String(mime).includes("pdf") || String(name).toLowerCase().endsWith(".pdf");
}

function isImageUrl(url = "") {
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic)(\?|#|$)/i.test(url);
}

function isPdfUrl(url = "") {
  return /\.pdf(\?|#|$)/i.test(url);
}

/** Превʼю файлу менеджера / столу конструктора (classPrefix: pm | cd). */
export function renderManagerFilePreview(
  positionId,
  file,
  { classPrefix = "pm", downloadUrl } = {}
) {
  const imgClass = `${classPrefix}-preview-img`;
  const pdfClass = `${classPrefix}-preview-pdf`;
  const hrefForFile = (f) => downloadUrl(positionId, f.id);

  if (file.externalUrl) {
    const url = escapeHtml(file.externalUrl);
    if (isImageUrl(file.externalUrl)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="${imgClass}" src="${url}" alt="" loading="lazy" /></a>`;
    }
    if (isPdfUrl(file.externalUrl)) {
      return `<iframe class="${pdfClass}" src="${url}" title="${escapeHtml(file.fileName || "PDF")}"></iframe>`;
    }
    return `<a class="btn btn-sm" href="${url}" target="_blank" rel="noopener noreferrer">Відкрити посилання</a>`;
  }

  const href = hrefForFile(file);
  if (isImageMime(file.mime) || /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(file.fileName || "")) {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"><img class="${imgClass}" src="${href}" alt="" loading="lazy" /></a>`;
  }
  if (isPdfMime(file.mime, file.fileName)) {
    return `<iframe class="${pdfClass}" src="${href}" title="${escapeHtml(file.fileName || "PDF")}"></iframe>`;
  }
  return `<a class="btn btn-sm" href="${href}" target="_blank" rel="noopener noreferrer" download>Завантажити ${escapeHtml(file.fileName || "файл")}</a>`;
}
