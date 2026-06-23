const LOGO_DARK = "/brand/enver-logo-dark.png";
const LOGO_LIGHT = "/brand/enver-logo-light.png";

/**
 * @param {"switch" | "light" | "dark"} mode
 * @param {string} [classExtra]
 */
export function brandLogoHtml(mode = "switch", classExtra = "") {
  const classes = ["enver-brand", classExtra].filter(Boolean).join(" ");

  if (mode === "light") {
    return `<span class="${classes}" role="img" aria-label="ENVER"><img class="enver-brand__img" src="${LOGO_LIGHT}" alt="" decoding="async" /></span>`;
  }

  if (mode === "dark") {
    return `<span class="${classes}" role="img" aria-label="ENVER"><img class="enver-brand__img" src="${LOGO_DARK}" alt="" decoding="async" /></span>`;
  }

  return `<span class="${classes} enver-brand--switch" role="img" aria-label="ENVER">
    <img class="enver-brand__img enver-brand__img--dark" src="${LOGO_DARK}" alt="" decoding="async" />
    <img class="enver-brand__img enver-brand__img--light" src="${LOGO_LIGHT}" alt="" decoding="async" />
  </span>`;
}
