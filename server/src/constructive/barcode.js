import QRCode from "qrcode";

export async function renderQrSvg(value, { width = 256 } = {}) {
  return QRCode.toString(String(value || ""), { type: "svg", margin: 1, width });
}

export async function renderQrDataUrl(value, { width = 256 } = {}) {
  return QRCode.toDataURL(String(value || ""), { margin: 1, width });
}

/** SVG штрихкоду (Code128-like representation via QR for simplicity in labels). */
export function renderBarcodeSvg(value) {
  const v = escapeXml(String(value || ""));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40" role="img" aria-label="${v}">
    <rect width="200" height="40" fill="#fff"/>
    <text x="100" y="26" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${v}</text>
  </svg>`;
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
