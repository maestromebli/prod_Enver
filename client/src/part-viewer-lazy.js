/** Lazy-load Three.js viewer для зменшення bundle operator PWA. */
export async function createPartViewerLazy(container, options) {
  const { createPartViewer } = await import("./part-viewer.js");
  return createPartViewer(container, options);
}
