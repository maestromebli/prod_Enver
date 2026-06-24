let loaded = false;

/** Підвантажує operator CSS лише коли потрібен (менеджерський app). */
export async function ensureOperatorStyles() {
  if (loaded) return;
  await Promise.all([import("./styles/operator.css"), import("./styles/operator-client.css")]);
  loaded = true;
}
