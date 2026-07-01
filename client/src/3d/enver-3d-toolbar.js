/** Спільна розмітка toolbar для 3D-простору ENVER (планшет / оператор). */

/**
 * @param {{ compact?: boolean, showFullscreen?: boolean, showParts?: boolean, showAdvanced?: boolean }} [opts]
 */
export function renderEnver3dToolbarHtml({
  compact = false,
  showFullscreen = false,
  showParts = true,
  showAdvanced = true
} = {}) {
  const advanced = showAdvanced
    ? `
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="drawing" title="Креслення">⬚</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="measure" title="Вимір">📏</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="section" title="Розріз">✂</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="wireframe" title="Каркас">◇</button>`
    : "";

  const sides = compact
    ? ""
    : `
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="left" title="Зліва">◀</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="right" title="Справа">▶</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="back" title="Ззаду">▷</button>`;

  const fullscreen = showFullscreen
    ? `<button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="fullscreen" title="На весь екран">⛶</button>`
    : "";

  const parts = showParts
    ? `<button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="parts-toggle" title="Деталі">☰</button>`
    : "";

  return `
    <div class="enver-3d-toolbar-row">
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="iso" title="Ізометрія">3D</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="top" title="Зверху">↑</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="bottom" title="Знизу">↓</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-camera="front" title="Спереду">▣</button>
      ${sides}
      ${advanced}
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="fit" title="Вмістити">◎</button>
      <button type="button" class="btn btn-sm enver-3d-btn" data-3d-action="all" title="Показати все">⊞</button>
      ${parts}
      ${fullscreen}
    </div>`;
}

/** Привʼязка кліків toolbar до viewer API. */
export function bindEnver3dToolbar(
  toolbar,
  viewer,
  { signal, partsPanel = null, onFullscreen } = {}
) {
  if (!toolbar || !viewer) return;

  toolbar.addEventListener(
    "click",
    (e) => {
      const camBtn = e.target.closest("[data-3d-camera]");
      if (camBtn) {
        viewer.setCameraPreset?.(camBtn.dataset["3dCamera"]);
        return;
      }
      const actionBtn = e.target.closest("[data-3d-action]");
      if (!actionBtn) return;
      const action = actionBtn.dataset["3dAction"];
      if (action === "fit") viewer.fitToView?.();
      if (action === "all") {
        viewer.showAll?.();
        viewer.resetMeshVisibility?.();
      }
      if (action === "drawing") {
        const on = !actionBtn.classList.contains("is-active");
        actionBtn.classList.toggle("is-active", on);
        viewer.setDrawingMode?.(on);
      }
      if (action === "measure") {
        const on = !actionBtn.classList.contains("is-active");
        actionBtn.classList.toggle("is-active", on);
        viewer.setMeasureEnabled?.(on);
        if (on) {
          toolbar.querySelector('[data-3d-action="section"]')?.classList.remove("is-active");
          viewer.setSectionEnabled?.(false);
        }
      }
      if (action === "section") {
        const on = !actionBtn.classList.contains("is-active");
        actionBtn.classList.toggle("is-active", on);
        viewer.setSectionEnabled?.(on);
        if (on) {
          toolbar.querySelector('[data-3d-action="measure"]')?.classList.remove("is-active");
          viewer.setMeasureEnabled?.(false);
        }
      }
      if (action === "wireframe") {
        const on = !actionBtn.classList.contains("is-active");
        actionBtn.classList.toggle("is-active", on);
        viewer.setWireframe?.(on);
      }
      if (action === "parts-toggle" && partsPanel) {
        const open = partsPanel.hidden;
        partsPanel.hidden = !open;
        partsPanel.classList.toggle("is-open", open);
      }
      if (action === "fullscreen") onFullscreen?.();
    },
    { signal }
  );
}
