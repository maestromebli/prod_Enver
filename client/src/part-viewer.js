import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLLoader } from "three/examples/jsm/loaders/VRMLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { apiUrl } from "./api.js";
import {
  formatPartPickerInfo,
  formatMeshBoundingBoxMm,
  resolvePartByMesh
} from "@enver/shared/production/constructive-package.js";
import { escapeHtml } from "./utils.js";

const SCENE_BG = 0xf0f2f5;
const PART_COLOR = 0x5c6f82;
const HIGHLIGHT_COLOR = 0xd97706;
const GHOST_COLOR = 0x94a3b8;
const EDGE_COLOR = 0x1e293b;
const EDGE_HIGHLIGHT_COLOR = 0xb45309;
const EDGE_GHOST_COLOR = 0x64748b;
const EDGE_THRESHOLD_DEG = 12;

/** Bazis VRML: невалідні DEF-імена (3-D, 8, кирилиця, +) ламають VRMLLoader. */
function sanitizeVrmlDefName(name) {
  let safe = String(name).replace(/[^A-Za-z0-9_]/g, "_");
  if (!safe || /^[0-9]/.test(safe)) safe = `Node_${safe}`;
  return safe;
}

function normalizeBazisVrml(text) {
  return String(text).replace(/DEF\s+([^\s{]+)/g, (match, name) => {
    const safe = sanitizeVrmlDefName(name);
    return safe === name ? match : `DEF ${safe}`;
  });
}

function detectModelFormat(url, format) {
  const explicit = String(format || "").toLowerCase();
  if (explicit && explicit !== "unknown") return explicit;
  const path = String(url || "")
    .split("?")[0]
    .toLowerCase();
  if (path.endsWith(".wrl")) return "wrl";
  if (path.endsWith(".gltf")) return "gltf";
  return "glb";
}

/** Three.js viewer з підсвіткою деталі та вибором кліком. */
export function createPartViewer(
  container,
  { onReady, onError, onPartSelect, pickable = true } = {}
) {
  if (!container) return { destroy() {} };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BG);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.01,
    1000
  );
  camera.position.set(2, 2, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, Math.max(container.clientHeight, 200));

  const wrap = document.createElement("div");
  wrap.className = "part-viewer-wrap";
  wrap.appendChild(renderer.domElement);

  const zoomBar = document.createElement("div");
  zoomBar.className = "part-viewer-zoom";
  zoomBar.innerHTML = `
    <button type="button" class="part-viewer-zoom-btn" data-zoom="in" aria-label="Збільшити" title="Збільшити">+</button>
    <button type="button" class="part-viewer-zoom-btn" data-zoom="out" aria-label="Зменшити" title="Зменшити">−</button>
  `;
  wrap.appendChild(zoomBar);

  const infoPanel = document.createElement("div");
  infoPanel.className = "part-viewer-info";
  infoPanel.hidden = true;
  infoPanel.innerHTML = `
    <button type="button" class="part-viewer-info-close" aria-label="Закрити">×</button>
    <div class="part-viewer-info-body"></div>
  `;
  wrap.appendChild(infoPanel);

  const pickHint = document.createElement("p");
  pickHint.className = "part-viewer-pick-hint enver-meta";
  pickHint.hidden = true;
  pickHint.textContent = "Клікніть на деталь";
  wrap.appendChild(pickHint);

  container.innerHTML = "";
  container.classList.add("part-viewer-host");
  container.appendChild(wrap);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-4, 2, -6);
  scene.add(fill);

  let model = null;
  let highlightMesh = null;
  let selectedMesh = null;
  let animId = null;
  let partCatalog = [];
  let pickingEnabled = pickable;

  const meshMap = new Map();
  const zoomVector = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;

  function cloneSurfaceMaterial(mat) {
    if (!mat) {
      return new THREE.MeshStandardMaterial({
        color: PART_COLOR,
        metalness: 0.08,
        roughness: 0.62
      });
    }
    if (mat.isMeshStandardMaterial) return mat.clone();
    return new THREE.MeshStandardMaterial({
      color: mat.color?.clone?.() ?? new THREE.Color(PART_COLOR),
      metalness: mat.metalness ?? 0.08,
      roughness: mat.roughness ?? 0.62,
      map: mat.map ?? null,
      transparent: Boolean(mat.transparent),
      opacity: mat.opacity ?? 1,
      side: mat.side ?? THREE.FrontSide
    });
  }

  function addPartEdges(mesh) {
    if (!mesh.geometry || mesh.userData.edgeLines) return;
    const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG);
    const lineMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
    const lines = new THREE.LineSegments(edges, lineMat);
    lines.name = `${mesh.name || "mesh"}-edges`;
    lines.raycast = () => {};
    mesh.add(lines);
    mesh.userData.edgeLines = lines;
    mesh.userData.originalEdgeColor = EDGE_COLOR;
  }

  function setEdgeStyle(mesh, color, { opacity = 1 } = {}) {
    const lines = mesh.userData.edgeLines;
    if (!lines?.material) return;
    lines.material.color.set(color);
    lines.material.opacity = opacity;
    lines.material.transparent = opacity < 1;
  }

  function prepareModelMeshes(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      addPartEdges(child);
      const source = child.material;
      if (Array.isArray(source)) {
        child.material = source.map((mat) => cloneSurfaceMaterial(mat));
      } else {
        child.material = cloneSurfaceMaterial(source);
      }
      child.userData.originalMaterial = child.material;
    });
  }

  function zoomBy(factor) {
    zoomVector.subVectors(camera.position, controls.target);
    const distance = zoomVector.length();
    if (!distance) return;
    const next = THREE.MathUtils.clamp(
      distance * factor,
      controls.minDistance,
      controls.maxDistance
    );
    zoomVector.setLength(next);
    camera.position.copy(controls.target).add(zoomVector);
    controls.update();
  }

  function bindZoomControls() {
    zoomBar.querySelectorAll("[data-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        zoomBy(btn.dataset.zoom === "in" ? 0.82 : 1.22);
      });
    });
  }
  bindZoomControls();

  infoPanel.querySelector(".part-viewer-info-close")?.addEventListener("click", () => {
    clearSelection();
  });

  function meshSizeLabelMm(mesh) {
    if (!mesh) return "";
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    return formatMeshBoundingBoxMm([size.x, size.y, size.z]);
  }

  function renderInfoPanel(part, mesh) {
    const meshName = mesh?.name || mesh?.parent?.name || "";
    const info = formatPartPickerInfo(part, {
      meshName,
      sizeLabel: meshSizeLabelMm(mesh)
    });
    const body = infoPanel.querySelector(".part-viewer-info-body");
    if (!body) return;
    body.innerHTML = `
      <p class="part-viewer-info-number">${escapeHtml(info.numberLine)}</p>
      <p class="part-viewer-info-name">${escapeHtml(info.name)}</p>
      <p class="part-viewer-info-dims">${escapeHtml(info.dimensions)}</p>
      ${info.material ? `<p class="part-viewer-info-material">${escapeHtml(info.material)}</p>` : ""}
    `;
    infoPanel.hidden = false;
    pickHint.hidden = true;
  }

  function applySelection(mesh) {
    if (!model) return;
    selectedMesh = mesh || null;
    model.traverse((child) => {
      if (!child.isMesh) return;
      const isTarget = child === selectedMesh;
      if (isTarget) {
        child.material = new THREE.MeshStandardMaterial({
          color: HIGHLIGHT_COLOR,
          emissive: 0x5c3a00,
          metalness: 0.15,
          roughness: 0.45
        });
        setEdgeStyle(child, EDGE_HIGHLIGHT_COLOR);
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
      }
      child.visible = true;
    });
  }

  function showAll() {
    if (!model) return;
    highlightMesh = null;
    selectedMesh = null;
    infoPanel.hidden = true;
    updatePickHint();
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.visible = true;
      child.material = child.userData.originalMaterial || child.material;
      setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
    });
  }

  function clearSelection() {
    selectedMesh = null;
    infoPanel.hidden = true;
    pickHint.hidden = !pickingEnabled;
    showAll();
    onPartSelect?.(null);
  }

  function selectMesh(mesh) {
    if (!mesh) {
      clearSelection();
      return;
    }
    if (selectedMesh === mesh) {
      clearSelection();
      return;
    }
    const part = resolvePartByMesh(mesh, partCatalog);
    applySelection(mesh);
    renderInfoPanel(part, mesh);
    onPartSelect?.(part || null, mesh);
  }

  function pickMeshAt(clientX, clientY) {
    if (!model || !pickingEnabled) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(model, true);
    const hit = hits.find(
      (h) => h.object?.isMesh && !String(h.object.name || "").endsWith("-edges")
    );
    selectMesh(hit?.object || null);
  }

  function bindPicking() {
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      if (!pickingEnabled) return;
      pointerDown = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!pickingEnabled || !pointerDown) return;
      const dx = e.clientX - pointerDown.x;
      const dy = e.clientY - pointerDown.y;
      pointerDown = null;
      if (dx * dx + dy * dy > 36) return;
      pickMeshAt(e.clientX, e.clientY);
    });
  }
  bindPicking();

  function updatePickHint() {
    pickHint.hidden = !pickingEnabled || Boolean(selectedMesh);
  }

  function setPartCatalog(parts = []) {
    partCatalog = Array.isArray(parts) ? parts : [];
    updatePickHint();
  }

  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function resize() {
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 200);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function indexMeshes(object) {
    meshMap.clear();
    object.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.userData.originalMaterial) {
        child.userData.originalMaterial = child.material;
      }
      const register = (name) => {
        const key = String(name || "").trim();
        if (key) meshMap.set(key, child);
      };
      register(child.name);
      let parent = child.parent;
      while (parent) {
        register(parent.name);
        parent = parent.parent;
      }
    });
  }

  function resolveMesh({ meshName, nodeId }) {
    const keys = new Set();
    for (const raw of [meshName, nodeId]) {
      const s = String(raw || "").trim();
      if (!s) continue;
      keys.add(s);
      keys.add(s.replace(/^0+/, "") || s);
      const n = Number(s);
      if (Number.isFinite(n)) keys.add(String(n));
    }
    for (const key of keys) {
      if (meshMap.has(key)) return meshMap.get(key);
    }
    for (const [name, mesh] of meshMap.entries()) {
      for (const key of keys) {
        if (name === key || name.endsWith(`-${key}`) || name.includes(key)) return mesh;
      }
    }
    return null;
  }

  function applyHighlight({ meshName, nodeId, isolate = false, ghost = true }) {
    if (!model) return;
    highlightMesh = resolveMesh({ meshName, nodeId });
    selectedMesh = null;
    infoPanel.hidden = true;
    updatePickHint();

    model.traverse((child) => {
      if (!child.isMesh) return;
      const isTarget = child === highlightMesh;

      if (isTarget) {
        child.material = new THREE.MeshStandardMaterial({
          color: HIGHLIGHT_COLOR,
          emissive: 0x5c3a00,
          metalness: 0.15,
          roughness: 0.45
        });
        setEdgeStyle(child, EDGE_HIGHLIGHT_COLOR);
        child.visible = true;
      } else if (isolate) {
        child.visible = false;
      } else if (ghost) {
        child.visible = true;
        child.material = new THREE.MeshStandardMaterial({
          color: GHOST_COLOR,
          transparent: true,
          opacity: 0.22,
          depthWrite: false
        });
        setEdgeStyle(child, EDGE_GHOST_COLOR, { opacity: 0.45 });
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
        child.visible = true;
      }
    });
  }

  function resetCamera() {
    camera.position.set(2, 2, 3);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function frameModel(object) {
    if (model) scene.remove(model);
    model = object;
    prepareModelMeshes(model);
    scene.add(model);
    indexMeshes(model);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) {
      const err = new Error("VRML без видимої геометрії");
      onError?.(err);
      throw err;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    camera.far = Math.max(1000, maxDim * 10);
    camera.near = Math.max(0.01, maxDim / 10000);
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(maxDim, maxDim * 0.8, maxDim * 1.2));
    controls.target.copy(center);
    controls.minDistance = Math.max(0.05, maxDim * 0.08);
    controls.maxDistance = Math.max(10, maxDim * 12);
    controls.update();
    updatePickHint();
    onReady?.();
    return model;
  }

  function loadGltfBuffer(buffer) {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(buffer, "", (gltf) => resolve(frameModel(gltf.scene)), reject);
    });
  }

  function loadVrmlText(text) {
    const loader = new VRMLLoader();
    const object = loader.parse(normalizeBazisVrml(text), "");
    return frameModel(object);
  }

  async function loadModel(url, token, { format } = {}) {
    const fullUrl = url.startsWith("http") ? url : apiUrl(url);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(fullUrl, { headers });
    if (!res.ok) throw new Error("Не вдалося завантажити 3D модель");

    const loadFormat = detectModelFormat(url, format);
    if (loadFormat === "wrl" || loadFormat === "wrl_model" || loadFormat === "vrml") {
      const text = await res.text();
      try {
        return loadVrmlText(text);
      } catch (err) {
        onError?.(err);
        throw err;
      }
    }

    const buffer = await res.arrayBuffer();
    return loadGltfBuffer(buffer);
  }

  return {
    loadModel(url, token, options) {
      return loadModel(url, token, options);
    },
    highlightPart(opts) {
      applyHighlight(opts || {});
    },
    setPartCatalog(parts) {
      setPartCatalog(parts);
    },
    selectPart({ meshName, nodeId } = {}) {
      const mesh = resolveMesh({ meshName, nodeId });
      if (mesh) selectMesh(mesh);
    },
    clearSelection,
    showAll,
    isolatePart(meshName) {
      applyHighlight({ meshName, isolate: true, ghost: false });
    },
    resetCamera,
    zoomIn() {
      zoomBy(0.82);
    },
    zoomOut() {
      zoomBy(1.22);
    },
    destroy() {
      if (animId) cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    }
  };
}
