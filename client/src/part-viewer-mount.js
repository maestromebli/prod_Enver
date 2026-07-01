/** Єдиний вхід для монтування 3D viewer у контейнер. */
import { DEFAULT_PART_VIEWER_THEME } from "./part-viewer.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import { resolveViewerModelUrl } from "./part-viewer-window.js";

export { DEFAULT_PART_VIEWER_THEME };

/** Контекст моделі для нижньої панелі деталі (окремий GLB або вирізка зі збірки). */
export function resolvePartDetailModelContext(
  part,
  { modelPayload = null, token = null, assemblyCtx = null } = {}
) {
  if (!part) return null;

  const partModelPath =
    modelPayload?.partModelUrl || (part.id ? `/api/parts/${part.id}/part-model` : null);
  if (partModelPath) {
    return {
      modelUrl: resolveViewerModelUrl(partModelPath, token),
      format: "glb",
      parts: modelPayload?.parts || assemblyCtx?.parts || [],
      isPartModel: true,
      mountKey: `part-model:${part.id}`
    };
  }

  if (assemblyCtx?.modelUrl) {
    return {
      modelUrl: assemblyCtx.modelUrl,
      format: assemblyCtx.format || "glb",
      parts: assemblyCtx.parts || [],
      isPartModel: false,
      mountKey: assemblyCtx.modelUrl
    };
  }

  return null;
}

export function applyPartDetailViewToViewer(
  viewer,
  part,
  targetHint = null,
  cadGeometry = null,
  { usePartModel = false } = {}
) {
  if (!viewer || !part) return false;
  const target = targetHint || resolvePartHighlightMesh(part);
  if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);

  if (usePartModel) {
    viewer.showPartDetail?.(part, target);
    viewer.fitToView?.();
    return true;
  }

  const mesh = viewer.showPartDetail?.(part, target);
  if (mesh) return true;

  if (!target?.meshName && !target?.nodeId) return false;

  viewer.highlightPart?.({
    meshName: target.meshName,
    nodeId: target.nodeId,
    isolate: true,
    ghost: false
  });
  return true;
}

/**
 * Нижня смуга 3D деталі: спочатку легкий part-model GLB, інакше вирізка зі збірки.
 * Повторний виклик з тим самим mountKey лише оновлює вид деталі.
 */
export async function mountPartDetailStripViewer(
  container,
  {
    part,
    cadGeometry = null,
    modelCtx,
    assemblyFallback = null,
    token = null,
    theme = DEFAULT_PART_VIEWER_THEME,
    pickable = false,
    existingViewer = null,
    loadingClass = "viewer-part-detail-loading"
  } = {}
) {
  if (!container || !part || !modelCtx?.modelUrl) return null;

  const target = resolvePartHighlightMesh(part);
  const mountKey = modelCtx.mountKey || modelCtx.modelUrl;

  if (existingViewer?.__enverMountKey === mountKey) {
    applyPartDetailViewToViewer(existingViewer, part, target, cadGeometry, {
      usePartModel: modelCtx.isPartModel
    });
    return existingViewer;
  }

  existingViewer?.destroy?.();
  container.innerHTML = `<p class="enver-meta ${loadingClass}">3D деталі…</p>`;

  const tryMount = async (ctx) => {
    const viewer = await mountModelViewer(container, {
      url: ctx.modelUrl,
      token,
      format: ctx.format || "glb",
      parts: ctx.parts || [],
      theme,
      detailOnly: !ctx.isPartModel,
      initialPart: part,
      initialPartHint: target,
      cadGeometry,
      viewerOptions: { pickable, detailOnly: !ctx.isPartModel }
    });
    viewer.__enverMountKey = ctx.mountKey || ctx.modelUrl;
    applyPartDetailViewToViewer(viewer, part, target, cadGeometry, {
      usePartModel: ctx.isPartModel
    });
    return viewer;
  };

  try {
    return await tryMount(modelCtx);
  } catch {
    if (modelCtx.isPartModel && assemblyFallback?.modelUrl) {
      try {
        return await tryMount({
          modelUrl: assemblyFallback.modelUrl,
          format: assemblyFallback.format || "glb",
          parts: assemblyFallback.parts || [],
          isPartModel: false,
          mountKey: assemblyFallback.modelUrl
        });
      } catch {
        /* нижче — заглушка */
      }
    }
    container.innerHTML = `<p class="enver-meta">3D деталі недоступна</p>`;
    return null;
  }
}

export async function mountModelViewer(
  container,
  {
    url,
    token = null,
    format,
    parts = [],
    onPartDoubleClick,
    onPartSelect,
    theme = DEFAULT_PART_VIEWER_THEME,
    viewerOptions = {},
    detailOnly = false,
    initialPart = null,
    initialPartHint = null,
    cadGeometry = null
  } = {}
) {
  if (!container || !url) return null;

  const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
  const resolvedTheme = theme || viewerOptions.theme || DEFAULT_PART_VIEWER_THEME;
  const viewer = await createPartViewerLazy(container, {
    onPartDoubleClick,
    onPartSelect,
    theme: resolvedTheme,
    detailOnly: detailOnly || viewerOptions.detailOnly,
    ...viewerOptions
  });
  if (parts?.length) viewer.setPartCatalog(parts);
  if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);
  if (initialPart) viewer.showPartDetail?.(initialPart, initialPartHint);
  await viewer.loadModel(url, token, { format });
  if (initialPart) {
    if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);
    viewer.showPartDetail?.(initialPart, initialPartHint);
  }
  return viewer;
}
