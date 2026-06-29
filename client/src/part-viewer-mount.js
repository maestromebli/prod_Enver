/** Єдиний вхід для монтування 3D viewer у контейнер. */
export async function mountModelViewer(container, { url, token = null, format, parts = [] } = {}) {
  if (!container || !url) return null;

  const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
  const viewer = await createPartViewerLazy(container);
  await viewer.loadModel(url, token, { format });
  if (parts?.length) viewer.setPartCatalog(parts);
  return viewer;
}
