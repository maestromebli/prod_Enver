/** operator.css завжди в головному бандлі (main.js); тут лише operator-client для edge-case. */
let clientLoaded = false;
let clientLoading = null;

export function isOperatorStylesLoaded() {
  return true;
}

/** Підвантажує operator-client CSS лише якщо потрібен поза operator.html. */
export async function ensureOperatorStyles() {
  if (clientLoaded || document.body?.classList.contains("operator-client-mode")) {
    return;
  }
  if (!clientLoading) {
    clientLoading = import("./styles/operator-client.css").then(() => {
      clientLoaded = true;
      clientLoading = null;
    });
  }
  await clientLoading;
}
