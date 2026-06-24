import { escapeHtml, $ } from "./utils.js";
import { api, getStoredToken, apiUrl } from "./api.js";
import { toastError, toastSuccess } from "./toast.js";

let mappingViewer = null;

export function renderModelMappingModal(detail) {
  const parts = detail?.parts || [];
  const unmapped = parts.filter((p) => !p.modelNodeId && !p.modelMeshName);
  const glbFile = detail?.files?.find((f) => f.kind === "glb_model" || f.kind === "gltf_model");

  return `
    <div class="modal-backdrop open" id="modelMappingModal">
      <div class="modal model-mapping-modal" role="dialog">
        <header class="model-mapping-head">
          <h2>Мапінг 3D деталей</h2>
          <button type="button" class="btn btn-sm" id="closeModelMappingBtn">Закрити</button>
        </header>
        <div class="model-mapping-body">
          <aside class="model-mapping-parts">
            <p class="enver-meta">${unmapped.length} деталей без звʼязку</p>
            <ul class="model-mapping-list">
              ${unmapped
                .map(
                  (p) => `
                <li>
                  <button type="button" class="model-mapping-part-btn" data-part-id="${p.id}" data-part-name="${escapeHtml(p.partName)}">
                    <strong>${escapeHtml(p.blockCode || "—")} · ${escapeHtml(p.partNo)}</strong>
                    <span>${escapeHtml(p.partName)}</span>
                  </button>
                </li>`
                )
                .join("")}
            </ul>
          </aside>
          <div class="model-mapping-viewer">
            <div id="modelMappingViewer3d" class="part-viewer-3d"></div>
            <p class="enver-meta" id="modelMappingHint">
              ${glbFile ? "Оберіть деталь зліва, потім введіть імʼя mesh з моделі." : "Завантажте GLB/GLTF для мапінгу."}
            </p>
            <div class="model-mapping-form">
              <input type="text" id="modelMeshNameInput" placeholder="Імʼя mesh (напр. B1_side_left)" />
              <button type="button" class="btn btn-primary" id="saveModelMappingBtn" disabled>Звʼязати деталь</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

let selectedPartId = null;

export async function openModelMappingModal(positionId, detail) {
  document.body.insertAdjacentHTML("beforeend", renderModelMappingModal(detail));

  $("#closeModelMappingBtn")?.addEventListener("click", closeModelMappingModal);
  $("#modelMappingModal")?.addEventListener("click", (e) => {
    if (e.target.id === "modelMappingModal") closeModelMappingModal();
  });

  document.querySelectorAll(".model-mapping-part-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPartId = Number(btn.dataset.partId);
      document
        .querySelectorAll(".model-mapping-part-btn")
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      $("#saveModelMappingBtn").disabled = false;
      const hint = $("#modelMappingHint");
      if (hint) hint.textContent = `Обрано: ${btn.dataset.partName}. Введіть імʼя mesh.`;
    });
  });

  $("#saveModelMappingBtn")?.addEventListener("click", async () => {
    const meshName = $("#modelMeshNameInput")?.value?.trim();
    if (!selectedPartId || !meshName || !detail?.package?.id) return;
    try {
      await api.saveModelMapping(positionId, detail.package.id, {
        mappings: [{ partId: selectedPartId, modelMeshName: meshName, modelNodeId: meshName }]
      });
      toastSuccess("Звʼязок збережено");
      closeModelMappingModal();
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });

  const glbFile = detail?.files?.find((f) => f.kind === "glb_model" || f.kind === "gltf_model");
  if (glbFile && detail?.package?.id) {
    const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
    const container = $("#modelMappingViewer3d");
    if (container) {
      mappingViewer = await createPartViewerLazy(container);
      const token = getStoredToken();
      const url = apiUrl(
        `/api/constructive/packages/${detail.package.id}/files/${glbFile.id}${token ? `?access_token=${encodeURIComponent(token)}` : ""}`
      );
      mappingViewer.loadModel(url, token).catch(() => {});
    }
  }
}

function closeModelMappingModal() {
  mappingViewer?.destroy();
  mappingViewer = null;
  selectedPartId = null;
  $("#modelMappingModal")?.remove();
}
