let loaded = false;
let loading = null;

export function isOperatorStylesLoaded() {
  return loaded;
}

/** Підвантажує operator CSS лише коли потрібен (менеджерський app). */
export async function ensureOperatorStyles() {
  if (loaded) return;
  if (!loading) {
    loading = Promise.all([
      import("./styles/operator.css"),
      import("./styles/operator-client.css")
    ]).then(() => {
      loaded = true;
      loading = null;
    });
  }
  await loading;
}
