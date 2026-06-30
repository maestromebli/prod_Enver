/** Єдиний вхід для монтування 3D viewer у контейнер. */
export async function mountModelViewer(
  container,
  {
    url,
    token = null,
    format,
    parts = [],
    onPartDoubleClick,
    onPartSelect,
    theme = "light",
    viewerOptions = {},
    detailOnly = false,
    initialPart = null,
    initialPartHint = null,
    cadGeometry = null
  } = {}
) {
  if (!container || !url) return null;

  const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
  const resolvedTheme = theme || viewerOptions.theme || "light";
  const viewer = await createPartViewerLazy(container, {
    onPartDoubleClick,
    onPartSelect,
    theme: resolvedTheme,
    detailOnly: detailOnly || viewerOptions.detailOnly,
    ...viewerOptions
  });
  if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);
  if (initialPart) viewer.showPartDetail?.(initialPart, initialPartHint);
  await viewer.loadModel(url, token, { format });
  if (parts?.length) viewer.setPartCatalog(parts);
  if (initialPart) {
    if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);
    viewer.showPartDetail?.(initialPart, initialPartHint);
  }
  return viewer;
}
