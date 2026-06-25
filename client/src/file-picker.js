/**
 * Відкрити нативне вікно вибору файлу на комп'ютері користувача.
 * Input створюється в body синхронно в межах user gesture — інакше браузер блокує діалог.
 *
 * @param {{ accept?: string, multiple?: boolean, directory?: boolean }} [options]
 * @returns {Promise<File | File[] | null>}
 */
export function pickLocalFile(options = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.accept) input.accept = options.accept;
    if (options.multiple) input.multiple = true;
    if (options.directory) {
      input.multiple = true;
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;";

    let settled = false;
    const timeoutId = setTimeout(() => finish(null), 60_000);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      input.remove();
      resolve(value);
    };

    input.addEventListener(
      "change",
      () => {
        if (options.multiple) {
          finish([...(input.files || [])]);
          return;
        }
        finish(input.files?.[0] || null);
      },
      { once: true }
    );

    document.body.appendChild(input);
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
      } else {
        input.click();
      }
    } catch {
      input.click();
    }
  });
}
