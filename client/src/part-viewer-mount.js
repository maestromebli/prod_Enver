/** Єдиний вхід для монтування 3D viewer у контейнер. */
export async function mountModelViewer(
  container,
  {
    url,
    token = null,
    format,
    parts = [],
    onPartDoubleClick,
    theme = "light",
    viewerOptions = {}
  } = {}
) {
  if (!container || !url) return null;

  const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
  const resolvedTheme = theme || viewerOptions.theme || "light";
  const viewer = await createPartViewerLazy(container, {
    onPartDoubleClick,
    theme: resolvedTheme,
    ...viewerOptions
  });
  await viewer.loadModel(url, token, { format });
  if (parts?.length) viewer.setPartCatalog(parts);
  return viewer;
}
