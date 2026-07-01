import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLLoader } from "three/examples/jsm/loaders/VRMLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { apiUrl } from "./api.js";
import {
  formatPartPickerInfo,
  formatMeshBoundingBoxMm,
  scaleLocalMeshExtents,
  detectSceneExtentsPreferMm,
  meshNameLookupKeys,
  partCatalogLookupKeys,
  resolvePartByMesh
} from "@enver/shared/production/constructive-package.js";
import {
  edgeSideMask,
  splitPartBazisOperations
} from "@enver/shared/production/part-detail-display.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import {
  mapCadHoleToLocal,
  measureDistanceMm,
  formatMeasureMm,
  resolvePanelMm,
  analyzePanelAxes
} from "@enver/shared/production/part-viewer-cad.js";
import { takePrefetchedModelBuffer } from "./part-viewer-prefetch.js";
import { escapeHtml } from "./utils.js";
import { createCameraAnimator, EXTENDED_CAMERA_PRESETS } from "./3d/enver-3d-camera.js";
import {
  buildHighlightResult,
  detectAmbiguousMeshes
} from "./3d/enver-3d-selection.js";
import { tintMaterialForStatus, pulseEmissiveIntensity } from "./3d/enver-3d-materials.js";
import { resolvePartMappingStatus } from "@enver/shared/production/part-model-mapping.js";

/** Палітри 3D-перегляду. `bazis` — наближено до вікна 3D у Базіс-Мебельщик (лише превʼю). */
const THEMES = {
  bazis: {
    sceneBg: 0xc6cacf,
    partColor: 0xc9a87c,
    highlightColor: 0xffcc00,
    ghostColor: 0x8e99a6,
    edgeColor: 0x383838,
    edgeHighlight: 0xff9900,
    edgeGhost: 0x6b7280,
    wrapClass: "part-viewer-wrap--bazis",
    cinematic: false,
    showGrid: true,
    castShadows: false,
    fog: false,
    exposure: 1.0,
    useLambert: true
  },
  studio: {
    sceneBg: 0x121a24,
    partColor: 0x9aaec3,
    highlightColor: 0xfbbf24,
    ghostColor: 0x64748b,
    edgeColor: 0xcbd5e1,
    edgeHighlight: 0xfcd34d,
    edgeGhost: 0x475569,
    wrapClass: "part-viewer-wrap--studio",
    cinematic: true,
    showGrid: true,
    castShadows: true,
    fog: true,
    exposure: 1.18,
    useLambert: false
  }
};

export const DEFAULT_PART_VIEWER_THEME = "bazis";

function pickTheme(name) {
  return name === "studio" ? THEMES.studio : THEMES.bazis;
}
const EDGE_KROMKA_COLOR = 0x16a34a;
const DRILL_MARKER_COLOR = 0xea580c;
const EDGE_THRESHOLD_DEG = 12;
const DRILL_MARKER_RADIUS = 0.006;

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
  {
    onReady,
    onError,
    onPartSelect,
    onPartDoubleClick,
    pickable = true,
    theme = DEFAULT_PART_VIEWER_THEME,
    detailOnly = false
  } = {}
) {
  if (!container) return { destroy() {} };

  const palette = pickTheme(theme);
  let PART_COLOR = palette.partColor;
  let HIGHLIGHT_COLOR = palette.highlightColor;
  let GHOST_COLOR = palette.ghostColor;
  let EDGE_COLOR = palette.edgeColor;
  let EDGE_HIGHLIGHT_COLOR = palette.edgeHighlight;
  let EDGE_GHOST_COLOR = palette.edgeGhost;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sceneBg);
  if (palette.fog) {
    scene.fog = new THREE.Fog(palette.sceneBg, 8, 48);
  }

  const perspectiveCamera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.01,
    1000
  );
  perspectiveCamera.position.set(2, 2, 3);
  let camera = perspectiveCamera;
  let orthographicCamera = null;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: detailOnly ? "low-power" : "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = palette.cinematic ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = palette.exposure;
  renderer.shadowMap.enabled = palette.castShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2.5)
  );
  renderer.setSize(container.clientWidth, Math.max(container.clientHeight, 200));

  const wrap = document.createElement("div");
  wrap.className = `part-viewer-wrap${palette.wrapClass ? ` ${palette.wrapClass}` : ""}${detailOnly ? " part-viewer-wrap--detail-only" : ""}`;
  wrap.appendChild(renderer.domElement);

  const zoomBar = document.createElement("div");
  zoomBar.className = "part-viewer-zoom";
  zoomBar.innerHTML = `
    <button type="button" class="part-viewer-zoom-btn" data-zoom="in" aria-label="Збільшити" title="Збільшити">+</button>
    <button type="button" class="part-viewer-zoom-btn" data-zoom="out" aria-label="Зменшити" title="Зменшити">−</button>
    <button type="button" class="part-viewer-zoom-btn" data-zoom="fit" aria-label="Вмістити" title="Вмістити модель">◎</button>
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
  pickHint.textContent = "Клік — інфо · Подвійний клік — деталь · M — вимір";
  wrap.appendChild(pickHint);

  const measureHud = document.createElement("div");
  measureHud.className = "part-viewer-measure-hud";
  measureHud.hidden = true;
  wrap.appendChild(measureHud);

  const sectionHud = document.createElement("div");
  sectionHud.className = "part-viewer-section-hud";
  sectionHud.hidden = true;
  sectionHud.innerHTML = `
    <div class="part-viewer-section-head">
      <span>Розріз</span>
      <div class="part-viewer-section-axes" role="group" aria-label="Вісь розрізу">
        <button type="button" class="part-viewer-section-axis" data-section-axis="x">X</button>
        <button type="button" class="part-viewer-section-axis is-active" data-section-axis="y">Y</button>
        <button type="button" class="part-viewer-section-axis" data-section-axis="z">Z</button>
      </div>
    </div>
    <input type="range" class="part-viewer-section-slider" min="5" max="95" value="55" aria-label="Позиція розрізу" />
  `;
  wrap.appendChild(sectionHud);

  const holeTooltip = document.createElement("div");
  holeTooltip.className = "part-viewer-hole-tooltip";
  holeTooltip.hidden = true;
  wrap.appendChild(holeTooltip);

  const panelDimsHud = document.createElement("div");
  panelDimsHud.className = "part-viewer-panel-dims";
  panelDimsHud.hidden = true;
  wrap.appendChild(panelDimsHud);

  container.innerHTML = "";
  container.classList.add("part-viewer-host");
  container.appendChild(wrap);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.rotateSpeed = 0.85;
  controls.panSpeed = 0.75;
  controls.maxPolarAngle = Math.PI;

  const cameraAnimator = createCameraAnimator({
    camera,
    controls,
    onTick: () => {
      /* render у animate() */
    }
  });

  if (palette.cinematic) {
    scene.add(new THREE.HemisphereLight(0xe8eef8, 0x2a3544, 0.62));
    const dir = new THREE.DirectionalLight(0xfffaf5, 1.05);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.bias = -0.0002;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xc8d8f0, 0.42);
    fill.position.set(-4, 2, -6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.28);
    rim.position.set(-6, 5, 8);
    scene.add(rim);
  } else {
    scene.add(new THREE.AmbientLight(0xffffff, 0.68));
    scene.add(new THREE.HemisphereLight(0xf2f4f7, 0x8a9199, 0.42));
    const bazisDir = new THREE.DirectionalLight(0xffffff, 0.32);
    bazisDir.position.set(4, 9, 6);
    scene.add(bazisDir);
  }

  let model = null;
  let gridHelper = null;
  let cadGeometry = null;
  let sectionEnabled = false;
  let sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  let sectionRatio = 0.55;
  let sectionAxis = "y";
  let measureEnabled = false;
  let measurePoints = [];
  let measureGroup = null;
  let wireframeEnabled = false;
  let drawingModeEnabled = false;
  let axesHelper = null;
  let shadowReceiver = null;
  let highlightMesh = null;
  let selectedMesh = null;
  let animId = null;
  let partCatalog = [];
  let pickingEnabled = pickable;
  let detailMarkers = null;
  /** @type {boolean | null} */
  let sceneExtentsPreferMm = null;
  const hiddenMeshes = new Set();
  const transparentMeshes = new Set();
  let assemblyGhostActive = false;
  let pendingDetailPart = null;
  let pendingDetailHint = null;
  let proceduralDetailGroup = null;
  /** @type {Map<string, string>} */
  let productionStatusByMesh = new Map();
  let pulseActive = false;
  let pulseStartMs = 0;

  const meshMap = new Map();
  const zoomVector = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;

  function cloneSurfaceMaterial(mat) {
    if (palette.useLambert) {
      const color = mat?.color?.clone?.() ?? new THREE.Color(PART_COLOR);
      return new THREE.MeshLambertMaterial({ color, side: THREE.FrontSide });
    }
    const baseMetal = palette.cinematic ? 0.14 : 0.08;
    const baseRough = palette.cinematic ? 0.56 : 0.62;
    if (!mat) {
      return new THREE.MeshStandardMaterial({
        color: PART_COLOR,
        metalness: baseMetal,
        roughness: baseRough
      });
    }
    if (mat.isMeshStandardMaterial) return mat.clone();
    return new THREE.MeshStandardMaterial({
      color: mat.color?.clone?.() ?? new THREE.Color(PART_COLOR),
      metalness: mat.metalness ?? baseMetal,
      roughness: mat.roughness ?? baseRough,
      map: mat.map ?? null,
      transparent: Boolean(mat.transparent),
      opacity: mat.opacity ?? 1,
      side: mat.side ?? THREE.FrontSide
    });
  }

  function highlightSurfaceMaterial() {
    if (palette.useLambert) {
      return new THREE.MeshLambertMaterial({
        color: HIGHLIGHT_COLOR,
        emissive: new THREE.Color(HIGHLIGHT_COLOR),
        emissiveIntensity: 0.18
      });
    }
    return new THREE.MeshStandardMaterial({
      color: HIGHLIGHT_COLOR,
      emissive: palette.cinematic ? 0x92400e : 0x5c3a00,
      emissiveIntensity: palette.cinematic ? 0.35 : 0.2,
      metalness: 0.15,
      roughness: 0.45
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

  function clearDetailMarkers() {
    if (!detailMarkers) return;
    const sharedGeom = detailMarkers.userData?.sharedDrillGeom;
    scene.remove(detailMarkers);
    detailMarkers.traverse((child) => {
      if (child.geometry && child.geometry !== sharedGeom) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material.dispose?.();
      }
    });
    sharedGeom?.dispose?.();
    detailMarkers = null;
    panelDimsHud.hidden = true;
    holeTooltip.hidden = true;
  }

  /** Підсвітка ребер кромки на верхньому периметрі панелі. */
  function applyKromkaEdgeHighlight(mesh, edgeCode, edgeMaskOverride = null) {
    const mask = Array.isArray(edgeMaskOverride) ? edgeMaskOverride : edgeSideMask(edgeCode);
    if (!mask.some(Boolean)) return;

    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const thinAxis =
      size.x <= size.y && size.x <= size.z ? "x" : size.y <= size.x && size.y <= size.z ? "y" : "z";
    const topValue = thinAxis === "x" ? box.max.x : thinAxis === "y" ? box.max.y : box.max.z;
    const tol = Math.max(size[thinAxis] * 0.6, 0.0005);

    const lines = mesh.userData.edgeLines;
    if (!lines?.geometry) return;

    const pos = lines.geometry.getAttribute("position");
    if (!pos) return;

    const colorAttr = new Float32Array(pos.count * 3);
    const base = new THREE.Color(EDGE_COLOR);
    const kromka = new THREE.Color(EDGE_KROMKA_COLOR);
    const center = box.getCenter(new THREE.Vector3());
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += 2) {
      p0.fromBufferAttribute(pos, i);
      p1.fromBufferAttribute(pos, i + 1);
      p0.applyMatrix4(mesh.matrixWorld);
      p1.applyMatrix4(mesh.matrixWorld);

      const onTop =
        thinAxis === "x"
          ? Math.abs(p0.x - topValue) < tol && Math.abs(p1.x - topValue) < tol
          : thinAxis === "y"
            ? Math.abs(p0.y - topValue) < tol && Math.abs(p1.y - topValue) < tol
            : Math.abs(p0.z - topValue) < tol && Math.abs(p1.z - topValue) < tol;

      let sideIdx = -1;
      if (onTop) {
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const dx = mid.x - center.x;
        const dz = mid.z - center.z;
        if (Math.abs(dz) >= Math.abs(dx)) {
          sideIdx = dz >= 0 ? 0 : 2;
        } else {
          sideIdx = dx >= 0 ? 1 : 3;
        }
      }

      const useKromka = sideIdx >= 0 && mask[sideIdx];
      const c = useKromka ? kromka : base;
      c.toArray(colorAttr, i * 3);
      c.toArray(colorAttr, (i + 1) * 3);
    }

    lines.geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
    lines.material.vertexColors = true;
    lines.material.needsUpdate = true;
  }

  function holeMarkerColor(diameterMm) {
    const d = Number(diameterMm) || 0;
    if (d >= 15) return 0xdc2626;
    if (d >= 8) return 0xea580c;
    return 0xf59e0b;
  }

  function partSurfaceColor(part) {
    const m = String(part?.material || "").toLowerCase();
    if (/біл|white|w980|snow/i.test(m)) return palette.useLambert ? 0xf0f0ec : 0xa8b8c8;
    if (/дуб|oak/i.test(m)) return 0xb8956a;
    if (/горіх|walnut|горх/i.test(m)) return 0x8b6914;
    if (/сонома|sonoma/i.test(m)) return 0xc4a574;
    return PART_COLOR;
  }

  function formatHoleTooltip(hole) {
    const d = hole.diameterMm ? `Ø${hole.diameterMm}` : "Отвір";
    const depth = hole.depthMm ? ` · глиб. ${hole.depthMm} мм` : "";
    if (hole.xMm != null && hole.yMm != null) {
      return `${d} · ${hole.xMm} × ${hole.yMm} мм${depth}`;
    }
    if (hole.yMm != null && hole.zMm != null) {
      return `${d} · Y${hole.yMm} Z${hole.zMm} мм${depth}`;
    }
    return `${d}${depth}`;
  }

  function addEdgeBands(box, edgeMask, group) {
    if (!edgeMask?.some(Boolean)) return;
    const { thin, wide, mid, size, min, max } = analyzePanelAxes(box);
    const t = Math.max(size[thin] * 0.14, 0.001);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    };
    const thinMid = (min[thin] + max[thin]) / 2;

    const addBand = (wKey, hKey, depthKey, pos) => {
      const geom = new THREE.BoxGeometry(size[wKey], size[hKey], size[depthKey]);
      const mesh = new THREE.Mesh(geom, mat.clone());
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.scale[depthKey] = t / Math.max(size[depthKey], 1e-6);
      group.add(mesh);
    };

    if (edgeMask[1]) {
      const pos = { x: center.x, y: center.y, z: center.z };
      pos[wide] = max[wide] - t * 0.5;
      pos[thin] = thinMid;
      addBand(mid, thin, wide, pos);
    }
    if (edgeMask[3]) {
      const pos = { x: center.x, y: center.y, z: center.z };
      pos[wide] = min[wide] + t * 0.5;
      pos[thin] = thinMid;
      addBand(mid, thin, wide, pos);
    }
    if (edgeMask[0]) {
      const pos = { x: center.x, y: center.y, z: center.z };
      pos[mid] = max[mid] - t * 0.5;
      pos[thin] = thinMid;
      addBand(wide, thin, mid, pos);
    }
    if (edgeMask[2]) {
      const pos = { x: center.x, y: center.y, z: center.z };
      pos[mid] = min[mid] + t * 0.5;
      pos[thin] = thinMid;
      addBand(wide, thin, mid, pos);
    }
  }

  /** Маркери свердління: реальні координати з Bazis CAD або fallback-сітка. */
  function addDrillMarkers(mesh, part, cad = cadGeometry) {
    clearDetailMarkers();
    const panelMm = resolvePanelMm(cad, part);
    const cadHoles = cad?.holes?.length ? cad.holes : null;
    const { drilling } = splitPartBazisOperations(part);

    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const group = new THREE.Group();
    group.name = "part-detail-drill-markers";

    const markerMat = new THREE.MeshStandardMaterial({
      color: DRILL_MARKER_COLOR,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.4,
      metalness: 0.25,
      roughness: 0.45
    });
    let hasMarkers = false;

    if (cadHoles?.length) {
      const scaleMm = Math.max(panelMm.dx || 0, panelMm.dy || 0, panelMm.dz || 0, 1);
      for (const hole of cadHoles) {
        const mapped = mapCadHoleToLocal(box, hole, panelMm);
        const dMm = hole.diameterMm || 5;
        const radius = Math.max((dMm / scaleMm) * Math.max(size.x, size.y, size.z) * 0.45, 0.0008);
        const depthMm = hole.depthMm || panelMm.dz || 10;
        const height = Math.max((depthMm / scaleMm) * size[mapped.thinAxis] * 0.9, radius * 2);
        const markerGeom = new THREE.CylinderGeometry(radius, radius, height, 12);
        const marker = new THREE.Mesh(
          markerGeom,
          new THREE.MeshStandardMaterial({
            color: holeMarkerColor(dMm),
            emissive: 0x451a03,
            emissiveIntensity: 0.35,
            metalness: 0.25,
            roughness: 0.45
          })
        );
        marker.position.set(mapped.x, mapped.y, mapped.z);
        if (mapped.thinAxis === "x") marker.rotation.z = Math.PI / 2;
        else if (mapped.thinAxis === "z") marker.rotation.x = Math.PI / 2;
        marker.castShadow = true;
        marker.userData.cadHole = hole;
        group.add(marker);
        hasMarkers = true;
      }
    } else if (drilling.length) {
      const markerGeom = new THREE.CylinderGeometry(
        DRILL_MARKER_RADIUS,
        DRILL_MARKER_RADIUS,
        1,
        10
      );
      const thinAxis =
        size.x <= size.y && size.x <= size.z
          ? "x"
          : size.y <= size.x && size.y <= size.z
            ? "y"
            : "z";
      const topValue = thinAxis === "x" ? box.max.x : thinAxis === "y" ? box.max.y : box.max.z;
      const cols = Math.ceil(Math.sqrt(drilling.length * 3));
      const inset = 0.12;
      let idx = 0;
      for (let op = 0; op < drilling.length; op++) {
        for (let j = 0; j < 3; j++) {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          const u = (col + 0.5) / cols;
          const v = (row + 0.5) / Math.max(1, Math.ceil((drilling.length * 3) / cols));
          const px = THREE.MathUtils.lerp(
            box.min.x + size.x * inset,
            box.max.x - size.x * inset,
            u
          );
          const pz = THREE.MathUtils.lerp(
            box.min.z + size.z * inset,
            box.max.z - size.z * inset,
            v
          );
          const marker = new THREE.Mesh(markerGeom, markerMat);
          if (thinAxis === "y") {
            marker.position.set(px, topValue + DRILL_MARKER_RADIUS * 2, pz);
            marker.scale.y = Math.max(size.y * 0.35, DRILL_MARKER_RADIUS * 4);
          } else if (thinAxis === "z") {
            marker.position.set(px, pz, topValue + DRILL_MARKER_RADIUS * 2);
            marker.rotation.x = Math.PI / 2;
            marker.scale.y = Math.max(size.z * 0.35, DRILL_MARKER_RADIUS * 4);
          } else {
            marker.position.set(topValue + DRILL_MARKER_RADIUS * 2, px, pz);
            marker.rotation.z = Math.PI / 2;
            marker.scale.y = Math.max(size.x * 0.35, DRILL_MARKER_RADIUS * 4);
          }
          group.add(marker);
          idx++;
          hasMarkers = true;
        }
      }
      group.userData.sharedDrillGeom = markerGeom;
    }

    if (cad?.edgeMask?.some(Boolean)) {
      addEdgeBands(box, cad.edgeMask, group);
      hasMarkers = true;
    }

    if (!hasMarkers) return;

    detailMarkers = group;
    scene.add(group);
  }

  function modelBounds(object = model) {
    if (!object) return null;
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return {
      box,
      center: box.getCenter(new THREE.Vector3()),
      size,
      maxDim: Math.max(size.x, size.y, size.z, 0.05)
    };
  }

  function fitToView(object = model) {
    const bounds = modelBounds(object);
    if (!bounds) return;
    const { center, maxDim } = bounds;
    camera.position
      .copy(center)
      .add(new THREE.Vector3(maxDim * 1.05, maxDim * 0.82, maxDim * 1.22));
    controls.target.copy(center);
    controls.minDistance = Math.max(0.02, maxDim * 0.12);
    controls.maxDistance = Math.max(8, maxDim * 14);
    controls.update();
    if (drawingModeEnabled) syncOrthoFrustum(bounds);
    if (scene.fog) {
      scene.fog.near = maxDim * 2.5;
      scene.fog.far = Math.max(40, maxDim * 18);
    }
  }

  const CAMERA_PRESETS = {
    iso: (center, maxDim) =>
      center.clone().add(new THREE.Vector3(maxDim * 1.05, maxDim * 0.82, maxDim * 1.22)),
    top: (center, maxDim) => center.clone().add(new THREE.Vector3(0, maxDim * 1.6, 0.001)),
    bottom: (center, maxDim) => center.clone().add(new THREE.Vector3(0, -maxDim * 1.6, 0.001)),
    front: (center, maxDim) =>
      center.clone().add(new THREE.Vector3(0, maxDim * 0.15, maxDim * 1.6)),
    left: (center, maxDim) =>
      center.clone().add(new THREE.Vector3(-maxDim * 1.6, maxDim * 0.15, 0)),
    right: (center, maxDim) => center.clone().add(new THREE.Vector3(maxDim * 1.6, maxDim * 0.15, 0)),
    back: EXTENDED_CAMERA_PRESETS.back
  };

  function setCameraPreset(preset = "iso") {
    const bounds = modelBounds();
    if (!bounds) return;
    const { center, maxDim } = bounds;
    const fn = CAMERA_PRESETS[preset] || CAMERA_PRESETS.iso;
    camera.position.copy(fn(center, maxDim));
    controls.target.copy(center);
    controls.minDistance = Math.max(0.02, maxDim * 0.12);
    controls.maxDistance = Math.max(8, maxDim * 14);
    controls.update();
    if (drawingModeEnabled) syncOrthoFrustum(bounds);
  }

  function getOrthoCamera() {
    if (!orthographicCamera) {
      orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    }
    return orthographicCamera;
  }

  function syncOrthoFrustum(bounds = null) {
    if (!camera.isOrthographicCamera) return;
    const b = bounds || modelBounds();
    if (!b) return;
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 200);
    const aspect = w / h;
    const halfH = b.maxDim * 0.62;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.near = 0.01;
    camera.far = Math.max(1000, b.maxDim * 10);
    camera.updateProjectionMatrix();
  }

  function switchToOrthoCamera() {
    const ortho = getOrthoCamera();
    ortho.position.copy(camera.position);
    ortho.quaternion.copy(camera.quaternion);
    camera = ortho;
    controls.object = camera;
  }

  function switchToPerspectiveCamera() {
    perspectiveCamera.position.copy(camera.position);
    perspectiveCamera.quaternion.copy(camera.quaternion);
    camera = perspectiveCamera;
    controls.object = camera;
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 200);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const DRAWING_BG = palette.cinematic ? 0x0f1724 : 0xffffff;
  const DRAWING_EDGE = palette.cinematic ? 0xe2e8f0 : 0x1a1a1a;

  function drawingSurfaceMaterial(part) {
    const base = partSurfaceColor(part);
    const color = new THREE.Color(base);
    if (palette.cinematic) color.lerp(new THREE.Color(0x94a3b8), 0.35);
    else color.lerp(new THREE.Color(0xffffff), 0.42);
    return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  }

  function applyDrawingSceneStyle(on) {
    if (on) {
      scene.background = new THREE.Color(DRAWING_BG);
      scene.fog = null;
      renderer.shadowMap.enabled = false;
      if (gridHelper) gridHelper.visible = false;
      wrap.classList.add("part-viewer-wrap--drawing");
    } else {
      scene.background = new THREE.Color(palette.sceneBg);
      if (palette.fog) scene.fog = new THREE.Fog(palette.sceneBg, 8, 48);
      renderer.shadowMap.enabled = palette.castShadows;
      if (gridHelper) gridHelper.visible = true;
      wrap.classList.remove("part-viewer-wrap--drawing");
    }
  }

  function applyDrawingMaterials(on) {
    if (!model) return;
    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      if (on) {
        const part = resolvePartByMesh(child, partCatalog);
        child.material = drawingSurfaceMaterial(part);
        setEdgeStyle(child, DRAWING_EDGE, { opacity: 1 });
        if (child.userData.edgeLines) child.userData.edgeLines.visible = true;
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
      }
    });
  }

  function exitDrawingModeForOverlay() {
    if (!drawingModeEnabled) return;
    drawingModeEnabled = false;
    if (camera.isOrthographicCamera) switchToPerspectiveCamera();
    applyDrawingSceneStyle(false);
  }

  function syncFloorGrid(box) {
    if (!palette.showGrid || !box || box.isEmpty()) return;
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry?.dispose?.();
      gridHelper.material?.dispose?.();
      gridHelper = null;
    }
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1.2) * 2.8;
    const [major, minor] = palette.cinematic ? [0x3d5268, 0x243040] : [0xa8adb5, 0x959aa3];
    gridHelper = new THREE.GridHelper(span, palette.cinematic ? 32 : 24, major, minor);
    gridHelper.position.y = box.min.y - 0.002;
    scene.add(gridHelper);
  }

  function frameMesh(mesh) {
    fitPartDetailView(mesh);
  }

  /** Камера вздовж найтоншої осі — плоска деталь як у Bazis (лицьом, не ребром). */
  function fitPartDetailView(object = highlightMesh || model) {
    const bounds = modelBounds(object);
    if (!bounds) return;
    const { center, size } = bounds;
    const axes = [
      { key: "x", len: size.x, dir: new THREE.Vector3(1, 0, 0) },
      { key: "y", len: size.y, dir: new THREE.Vector3(0, 1, 0) },
      { key: "z", len: size.z, dir: new THREE.Vector3(0, 0, 1) }
    ].sort((a, b) => a.len - b.len);

    const thin = axes[0];
    const faceSpan = Math.max(axes[1].len, axes[2].len, 0.05);
    const mid = axes[1];

    camera.position.copy(center).add(thin.dir.clone().multiplyScalar(faceSpan * 1.2));
    camera.position.add(mid.dir.clone().multiplyScalar(faceSpan * 0.08));
    controls.target.copy(center);
    controls.minDistance = Math.max(0.02, faceSpan * 0.12);
    controls.maxDistance = Math.max(8, faceSpan * 14);
    controls.update();
    if (drawingModeEnabled) syncOrthoFrustum(bounds);
  }

  function meshesForPart(part) {
    if (!model || !part) return [];
    const partKeys = partCatalogLookupKeys(part);
    const found = new Set();
    model.traverse((child) => {
      if (!child.isMesh || String(child.name || "").endsWith("-edges")) return;
      const nameKeys = meshNameLookupKeys(child.name);
      for (const key of nameKeys) {
        if (partKeys.has(key)) {
          found.add(child);
          break;
        }
      }
    });
    const target = resolveMesh(resolvePartHighlightMesh(part) || {});
    if (target) found.add(target);
    return [...found];
  }

  function panelSurfaceMaterial(part) {
    const color = partSurfaceColor(part);
    if (palette.useLambert) {
      return new THREE.MeshLambertMaterial({ color, side: THREE.FrontSide });
    }
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.1,
      roughness: 0.55
    });
  }

  function clearProceduralDetail() {
    if (!proceduralDetailGroup) return;
    scene.remove(proceduralDetailGroup);
    proceduralDetailGroup.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });
    proceduralDetailGroup = null;
  }

  function buildProceduralDetailMesh(part, cad = cadGeometry) {
    const panelMm = resolvePanelMm(cad, part);
    const dx = Math.max((panelMm.dx || Number(part?.length) || 100) / 1000, 0.001);
    const dy = Math.max((panelMm.dz || Number(part?.thickness) || 18) / 1000, 0.001);
    const dz = Math.max((panelMm.dy || Number(part?.width) || 100) / 1000, 0.001);
    const geom = new THREE.BoxGeometry(dx, dy, dz);
    const mesh = new THREE.Mesh(geom, panelSurfaceMaterial(part));
    mesh.name =
      part?.modelMeshName ||
      part?.model_mesh_name ||
      `panel-${part?.partNo || part?.part_no || "0"}`;
    mesh.position.y = dy / 2;
    setEdgeStyle(mesh, EDGE_COLOR);
    applyKromkaEdgeHighlight(mesh, part?.edgeCode || part?.edge_code, cad?.edgeMask);
    const group = new THREE.Group();
    group.name = "procedural-part-detail";
    group.add(mesh);
    return { group, mesh };
  }

  function applyPartDetailView(part, targetHint = null) {
    if (!part) return null;
    exitDrawingModeForOverlay();
    assemblyGhostActive = false;
    clearDetailMarkers();
    clearSelection();
    clearProceduralDetail();

    if (!model) {
      const built = buildProceduralDetailMesh(part, cadGeometry);
      proceduralDetailGroup = built.group;
      scene.add(proceduralDetailGroup);
      highlightMesh = built.mesh;
      addDrillMarkers(built.mesh, part, cadGeometry);
      const panelMm = resolvePanelMm(cadGeometry, part);
      if (panelMm.dx && panelMm.dy && panelMm.dz) {
        panelDimsHud.textContent = `${panelMm.dx} × ${panelMm.dy} × ${panelMm.dz} мм`;
        panelDimsHud.hidden = false;
      } else {
        panelDimsHud.hidden = true;
      }
      frameMesh(built.mesh);
      return built.mesh;
    }

    const targets = meshesForPart(part);
    const hint = targetHint || resolvePartHighlightMesh(part) || {};
    const primary =
      resolveMesh(hint) || targets[0] || findMeshByPartNo(part.partNo || part.part_no) || null;
    if (!primary) {
      const built = buildProceduralDetailMesh(part, cadGeometry);
      proceduralDetailGroup = built.group;
      scene.add(proceduralDetailGroup);
      model.traverse((child) => {
        if (isRenderableMesh(child)) child.visible = false;
      });
      highlightMesh = built.mesh;
      addDrillMarkers(built.mesh, part, cadGeometry);
      const panelMm = resolvePanelMm(cadGeometry, part);
      if (panelMm.dx && panelMm.dy && panelMm.dz) {
        panelDimsHud.textContent = `${panelMm.dx} × ${panelMm.dy} × ${panelMm.dz} мм`;
        panelDimsHud.hidden = false;
      } else {
        panelDimsHud.hidden = true;
      }
      frameMesh(built.mesh);
      return built.mesh;
    }

    const targetSet = new Set(targets.length ? targets : [primary]);
    highlightMesh = primary;
    selectedMesh = null;
    infoPanel.hidden = true;
    updatePickHint();

    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      const isTarget = targetSet.has(child);
      if (isTarget) {
        child.material = panelSurfaceMaterial(part);
        setEdgeStyle(child, EDGE_COLOR);
        applyKromkaEdgeHighlight(child, part.edgeCode || part.edge_code, cadGeometry?.edgeMask);
        child.visible = true;
      } else {
        child.visible = false;
      }
    });

    addDrillMarkers(primary, part, cadGeometry);
    const panelMm = resolvePanelMm(cadGeometry, part);
    if (panelMm.dx && panelMm.dy && panelMm.dz) {
      panelDimsHud.textContent = `${panelMm.dx} × ${panelMm.dy} × ${panelMm.dz} мм`;
      panelDimsHud.hidden = false;
    } else {
      panelDimsHud.hidden = true;
    }
    frameMesh(primary);
    return primary;
  }

  function queueDetailPart(part, targetHint = null) {
    pendingDetailPart = part || null;
    pendingDetailHint = targetHint || null;
    if (model && part) return applyPartDetailView(part, targetHint);
    return null;
  }

  function applyPendingDetailView() {
    if (!pendingDetailPart || !model) return null;
    return applyPartDetailView(pendingDetailPart, pendingDetailHint);
  }

  function applyClippingToMaterials(enabled) {
    if (!model) return;
    const planes = enabled ? [sectionPlane] : [];
    model.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.clippingPlanes = planes;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      }
    });
  }

  function syncSectionPlane() {
    const root = detailPickRoot();
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    const min = box.min[sectionAxis];
    const max = box.max[sectionAxis];
    const value = THREE.MathUtils.lerp(min, max, sectionRatio);
    if (sectionAxis === "x") sectionPlane.set(new THREE.Vector3(-1, 0, 0), value);
    else if (sectionAxis === "z") sectionPlane.set(new THREE.Vector3(0, 0, -1), value);
    else sectionPlane.set(new THREE.Vector3(0, -1, 0), value);
    applyClippingToMaterials(sectionEnabled);
  }

  function setSectionAxis(axis) {
    sectionAxis = axis === "x" || axis === "z" ? axis : "y";
    sectionHud.querySelectorAll("[data-section-axis]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.sectionAxis === sectionAxis);
    });
    syncSectionPlane();
  }

  function setSectionEnabled(enabled) {
    sectionEnabled = Boolean(enabled);
    sectionHud.hidden = !sectionEnabled;
    syncSectionPlane();
  }

  function clearMeasure() {
    measurePoints = [];
    if (measureGroup) {
      scene.remove(measureGroup);
      measureGroup.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      measureGroup = null;
    }
    measureHud.hidden = true;
    measureHud.textContent = "";
  }

  function setMeasureEnabled(enabled) {
    measureEnabled = Boolean(enabled);
    if (!measureEnabled) clearMeasure();
    else {
      measureHud.hidden = false;
      measureHud.textContent = "Вимір: клікніть дві точки на деталі";
    }
  }

  function addMeasureMarker(point) {
    if (!measureGroup) {
      measureGroup = new THREE.Group();
      measureGroup.name = "part-viewer-measure";
      scene.add(measureGroup);
    }
    const geom = new THREE.SphereGeometry(0.004, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e });
    const marker = new THREE.Mesh(geom, mat);
    marker.position.copy(point);
    measureGroup.add(marker);
  }

  function finalizeMeasure() {
    if (measurePoints.length < 2) return;
    const panelMm = resolvePanelMm(cadGeometry, {});
    const root = detailPickRoot();
    const box = root ? new THREE.Box3().setFromObject(root) : new THREE.Box3();
    const dist = measureDistanceMm(measurePoints[0], measurePoints[1], box, panelMm);
    measureHud.textContent = `Відстань: ${formatMeasureMm(dist)}`;
    const lineGeom = new THREE.BufferGeometry().setFromPoints(measurePoints);
    const line = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 })
    );
    measureGroup.add(line);
    measurePoints = [];
  }

  function handleMeasurePick(point) {
    measurePoints.push(point.clone());
    addMeasureMarker(point);
    if (measurePoints.length >= 2) finalizeMeasure();
    else measureHud.textContent = "Вимір: оберіть другу точку";
  }

  function setWireframe(enabled) {
    if (drawingModeEnabled && enabled) return;
    wireframeEnabled = Boolean(enabled);
    const root = detailPickRoot();
    if (!root) return;
    root.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.wireframe = wireframeEnabled;
      }
    });
  }

  function setAxesVisible(enabled) {
    if (axesHelper) {
      scene.remove(axesHelper);
      axesHelper.geometry?.dispose?.();
      axesHelper.material?.dispose?.();
      axesHelper = null;
    }
    if (enabled) {
      axesHelper = new THREE.AxesHelper(0.25);
      scene.add(axesHelper);
    }
  }

  function syncShadowReceiver(box) {
    if (shadowReceiver) {
      scene.remove(shadowReceiver);
      shadowReceiver.geometry?.dispose?.();
      shadowReceiver.material?.dispose?.();
      shadowReceiver = null;
    }
    if (!palette.cinematic || !box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1) * 1.6;
    const geom = new THREE.PlaneGeometry(span, span);
    const mat = new THREE.ShadowMaterial({ opacity: 0.22 });
    shadowReceiver = new THREE.Mesh(geom, mat);
    shadowReceiver.rotation.x = -Math.PI / 2;
    shadowReceiver.position.y = box.min.y - 0.003;
    shadowReceiver.receiveShadow = true;
    scene.add(shadowReceiver);
  }

  function setCadGeometry(geometry) {
    cadGeometry = geometry || null;
  }

  sectionHud.querySelector(".part-viewer-section-slider")?.addEventListener("input", (e) => {
    sectionRatio = Number(e.target.value) / 100;
    syncSectionPlane();
  });
  sectionHud.querySelectorAll("[data-section-axis]").forEach((btn) => {
    btn.addEventListener("click", () => setSectionAxis(btn.dataset.sectionAxis));
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!detailMarkers?.children?.length) {
      holeTooltip.hidden = true;
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(detailMarkers.children, false);
    const hit = hits.find((h) => h.object?.userData?.cadHole);
    if (!hit) {
      holeTooltip.hidden = true;
      return;
    }
    holeTooltip.textContent = formatHoleTooltip(hit.object.userData.cadHole);
    holeTooltip.style.left = `${e.clientX - rect.left + 12}px`;
    holeTooltip.style.top = `${e.clientY - rect.top + 12}px`;
    holeTooltip.hidden = false;
  });

  wrap.addEventListener("pointerleave", () => {
    holeTooltip.hidden = true;
  });

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
      child.castShadow = palette.castShadows;
      child.receiveShadow = palette.castShadows;
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
        const mode = btn.dataset.zoom;
        if (mode === "fit") {
          fitToView();
          return;
        }
        zoomBy(mode === "in" ? 0.82 : 1.22);
      });
    });
  }
  bindZoomControls();

  infoPanel.querySelector(".part-viewer-info-close")?.addEventListener("click", () => {
    clearSelection();
  });

  function measureMeshExtents(mesh) {
    if (!mesh) return [];
    const geom = mesh.geometry;
    if (geom?.attributes?.position) {
      if (!geom.boundingBox) geom.computeBoundingBox();
      const local = geom.boundingBox.getSize(new THREE.Vector3());
      const worldScale = new THREE.Vector3();
      mesh.getWorldScale(worldScale);
      return scaleLocalMeshExtents(
        [local.x, local.y, local.z],
        [worldScale.x, worldScale.y, worldScale.z]
      );
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    return [size.x, size.y, size.z].filter((v) => v > 0);
  }

  function meshSizeLabelMm(mesh) {
    return formatMeshBoundingBoxMm(measureMeshExtents(mesh), {
      preferMm: sceneExtentsPreferMm
    });
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
        child.material = highlightSurfaceMaterial();
        setEdgeStyle(child, EDGE_HIGHLIGHT_COLOR);
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
      }
      child.visible = true;
    });
  }

  function showAll() {
    if (!model && !proceduralDetailGroup) return;
    clearProceduralDetail();
    clearDetailMarkers();
    highlightMesh = null;
    assemblyGhostActive = false;
    selectedMesh = null;
    infoPanel.hidden = true;
    updatePickHint();
    if (detailOnly && pendingDetailPart) {
      applyPartDetailView(pendingDetailPart, pendingDetailHint);
      return;
    }
    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      if (hiddenMeshes.has(child.name)) {
        child.visible = false;
        return;
      }
      child.visible = true;
      if (transparentMeshes.has(child.name)) {
        applyGhostMaterial(child);
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
      }
    });
    applyProductionStatusTints();
  }

  function clearSelection() {
    selectedMesh = null;
    infoPanel.hidden = true;
    pickHint.hidden = !pickingEnabled;
    if (detailOnly && pendingDetailPart) {
      applyPartDetailView(pendingDetailPart, pendingDetailHint);
      onPartSelect?.(null);
      return;
    }
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

  function detailPickRoot() {
    return proceduralDetailGroup || model;
  }

  function pickMeshAt(clientX, clientY) {
    const root = detailPickRoot();
    if (!root || !pickingEnabled) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(root, true);
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

      if (measureEnabled && detailPickRoot()) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const root = detailPickRoot();
        const hits = raycaster.intersectObject(root, true);
        const hit = hits.find(
          (h) => h.object?.isMesh && !String(h.object.name || "").endsWith("-edges")
        );
        if (hit?.point) handleMeasurePick(hit.point);
        return;
      }

      pickMeshAt(e.clientX, e.clientY);
    });
    canvas.addEventListener("dblclick", (e) => {
      if (!pickingEnabled || !onPartDoubleClick) return;
      e.preventDefault();
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const root = detailPickRoot();
      if (!root) return;
      const hits = raycaster.intersectObject(root, true);
      const hit = hits.find(
        (h) => h.object?.isMesh && !String(h.object.name || "").endsWith("-edges")
      );
      if (!hit?.object) return;
      const part = resolvePartByMesh(hit.object, partCatalog);
      onPartDoubleClick(part || null, hit.object);
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

  function applyPulseToHighlight() {
    if (!pulseActive || !highlightMesh?.material) return;
    const elapsed = (performance.now() - pulseStartMs) / 1000;
    const intensity = pulseEmissiveIntensity(elapsed);
    if (intensity <= 0) {
      pulseActive = false;
      return;
    }
    const mat = highlightMesh.material;
    if (mat.emissiveIntensity != null) mat.emissiveIntensity = intensity;
  }

  function triggerScanPulse() {
    pulseActive = true;
    pulseStartMs = performance.now();
    wrap.classList.add("part-viewer-wrap--scan-pulse");
    window.setTimeout(() => wrap.classList.remove("part-viewer-wrap--scan-pulse"), 1300);
  }

  function applyProductionStatusTints() {
    if (!model || highlightMesh || assemblyGhostActive) return;
    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      if (hiddenMeshes.has(child.name)) return;
      const status = productionStatusByMesh.get(child.name);
      if (!status) {
        child.material = child.userData.originalMaterial || child.material;
        return;
      }
      const base = child.userData.originalMaterial || child.material;
      child.material = tintMaterialForStatus(base, status, { useLambert: palette.useLambert });
    });
  }

  function animate() {
    animId = requestAnimationFrame(animate);
    applyPulseToHighlight();
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function resize() {
    const w = container.clientWidth;
    const h = Math.max(container.clientHeight, 200);
    if (camera.isOrthographicCamera) syncOrthoFrustum();
    else {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
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
    const searchKeys = new Set();
    for (const raw of [meshName, nodeId]) {
      for (const key of meshNameLookupKeys(raw)) searchKeys.add(key);
    }
    for (const key of searchKeys) {
      if (meshMap.has(key)) return meshMap.get(key);
    }
    for (const [name, mesh] of meshMap.entries()) {
      const nameKeys = meshNameLookupKeys(name);
      for (const key of searchKeys) {
        if (nameKeys.has(key)) return mesh;
      }
    }
    return null;
  }

  function findMeshByPartNo(partNo) {
    const key = String(partNo || "").trim();
    if (!key || !model) return null;
    const bare = key.replace(/^0+/, "") || key;
    let found = null;
    model.traverse((child) => {
      if (!child.isMesh || String(child.name || "").endsWith("-edges") || found) return;
      for (const nameKey of meshNameLookupKeys(child.name)) {
        const panelBare = nameKey.replace(/^panel-/i, "").replace(/^0+/, "");
        if (nameKey === key || nameKey === bare || panelBare === bare || panelBare === key) {
          found = child;
          return;
        }
      }
    });
    return found;
  }

  function isRenderableMesh(child) {
    return child.isMesh && !String(child.name || "").endsWith("-edges");
  }

  function meshDisplayName(mesh) {
    const part = resolvePartByMesh(mesh, partCatalog);
    if (part?.partName) return part.partName;
    return mesh.name || "Деталь";
  }

  function listMeshes() {
    if (!model) return [];
    const items = [];
    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      const part = resolvePartByMesh(child, partCatalog);
      items.push({
        name: child.name,
        label: meshDisplayName(child),
        partNo: part?.partNo || part?.part_no || "",
        blockCode: part?.blockCode || "",
        visible: !hiddenMeshes.has(child.name),
        transparent: transparentMeshes.has(child.name)
      });
    });
    return items;
  }

  function applyGhostMaterial(child) {
    const opacity = transparentMeshes.has(child.name) ? 0.08 : 0.22;
    if (palette.useLambert) {
      child.material = new THREE.MeshLambertMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity,
        depthWrite: false
      });
    } else {
      child.material = new THREE.MeshStandardMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity,
        depthWrite: false
      });
    }
    setEdgeStyle(child, EDGE_GHOST_COLOR, {
      opacity: transparentMeshes.has(child.name) ? 0.25 : 0.45
    });
  }

  function setMeshVisible(meshName, visible) {
    if (!meshName) return;
    if (visible) hiddenMeshes.delete(meshName);
    else hiddenMeshes.add(meshName);
    refreshMeshVisibility();
  }

  function setMeshTransparent(meshName, transparent) {
    if (!meshName) return;
    if (transparent) transparentMeshes.add(meshName);
    else transparentMeshes.delete(meshName);
    refreshMeshVisibility();
  }

  function resetMeshVisibility() {
    hiddenMeshes.clear();
    transparentMeshes.clear();
    refreshMeshVisibility();
  }

  function refreshMeshVisibility() {
    if (!model) return;
    if (drawingModeEnabled) {
      applyDrawingMaterials(true);
      model.traverse((child) => {
        if (!isRenderableMesh(child)) return;
        child.visible = !hiddenMeshes.has(child.name);
      });
      return;
    }
    if (assemblyGhostActive && highlightMesh) {
      applyHighlight({
        meshName: highlightMesh.name,
        nodeId: highlightMesh.name,
        ghost: true,
        isolate: false
      });
      return;
    }
    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      if (hiddenMeshes.has(child.name)) {
        child.visible = false;
        return;
      }
      child.visible = true;
      if (transparentMeshes.has(child.name)) {
        applyGhostMaterial(child);
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
      }
    });
  }

  function setDrawingMode(enabled) {
    const on = Boolean(enabled);
    if (drawingModeEnabled === on) return;
    drawingModeEnabled = on;

    if (on) {
      if (wireframeEnabled) setWireframe(false);
      showAll();
      if (!camera.isOrthographicCamera) switchToOrthoCamera();
      setCameraPreset("top");
      syncOrthoFrustum();
      applyDrawingSceneStyle(true);
      applyDrawingMaterials(true);
      model?.traverse((child) => {
        if (!isRenderableMesh(child)) return;
        if (!hiddenMeshes.has(child.name)) child.visible = true;
      });
      return;
    }

    if (camera.isOrthographicCamera) switchToPerspectiveCamera();
    applyDrawingSceneStyle(false);
    applyDrawingMaterials(false);
    refreshMeshVisibility();
    fitToView();
  }

  function applyHighlight({
    meshName,
    nodeId,
    isolate = false,
    ghost = true,
    ghostOthers = null,
    pulse = false
  } = {}) {
    const useGhost = ghostOthers != null ? Boolean(ghostOthers) : Boolean(ghost);
    exitDrawingModeForOverlay();
    assemblyGhostActive = Boolean(useGhost && !isolate);
    if (!model) return;
    highlightMesh = resolveMesh({ meshName, nodeId });
    if (useGhost && !highlightMesh && (meshName || nodeId)) {
      showAll();
      return;
    }
    selectedMesh = null;
    infoPanel.hidden = true;
    updatePickHint();

    model.traverse((child) => {
      if (!isRenderableMesh(child)) return;
      const isTarget = child === highlightMesh;

      if (hiddenMeshes.has(child.name) && !isTarget) {
        child.visible = false;
        return;
      }

      if (isTarget) {
        child.material = highlightSurfaceMaterial();
        setEdgeStyle(child, EDGE_HIGHLIGHT_COLOR);
        child.visible = true;
      } else if (isolate) {
        child.visible = false;
      } else if (useGhost) {
        child.visible = true;
        applyGhostMaterial(child);
      } else {
        child.material = child.userData.originalMaterial || child.material;
        setEdgeStyle(child, child.userData.originalEdgeColor ?? EDGE_COLOR);
        child.visible = true;
      }
    });

    if (pulse && highlightMesh) triggerScanPulse();
  }

  function resolveMeshForPart(part, targetHint = null) {
    if (!model || !part) return null;
    const hint = targetHint || resolvePartHighlightMesh(part) || {};
    const fromHint = resolveMesh(hint);
    if (fromHint) return fromHint;

    const targets = meshesForPart(part);
    if (targets.length) return targets[0];

    return findMeshByPartNo(part.partNo || part.part_no);
  }

  /** Підсвітка деталі на загальному виробі + кріплення та вирізи кромки. */
  function showPartOnAssemblyImpl(part, targetHint = null) {
    return showPartOnAssemblyResultImpl(part, targetHint).mesh;
  }

  function showPartOnAssemblyResultImpl(part, targetHint = null) {
    if (!model || !part) {
      return buildHighlightResult({
        ok: false,
        part,
        reason: "viewer_not_ready"
      });
    }

    clearDetailMarkers();
    const hint = targetHint || resolvePartHighlightMesh(part) || {};

    if (detectAmbiguousMeshes(model, meshesForPart, part, hint, resolveMesh)) {
      fitToView(model);
      return buildHighlightResult({
        ok: false,
        meshName: hint.meshName || null,
        nodeId: hint.nodeId || null,
        part,
        mappingStatus: "ambiguous",
        reason: "ambiguous_mesh"
      });
    }

    const mesh = resolveMeshForPart(part, targetHint);

    if (!mesh) {
      fitToView(model);
      const expected = hint.meshName || hint.nodeId || null;
      const mapping = resolvePartMappingStatus(part);
      return buildHighlightResult({
        ok: false,
        meshName: expected,
        nodeId: hint.nodeId || null,
        part,
        mappingStatus: mapping.mappingStatus,
        reason: expected ? "mesh_not_found" : "no_mapping_hint"
      });
    }

    applyHighlight({
      meshName: mesh.name,
      nodeId: mesh.name,
      ghostOthers: true,
      isolate: false,
      pulse: true
    });
    const primary = highlightMesh || mesh;

    applyKromkaEdgeHighlight(primary, part.edgeCode || part.edge_code, cadGeometry?.edgeMask);
    addDrillMarkers(primary, part, cadGeometry);
    const panelMm = resolvePanelMm(cadGeometry, part);
    if (panelMm.dx && panelMm.dy && panelMm.dz) {
      panelDimsHud.textContent = `${panelMm.dx} × ${panelMm.dy} × ${panelMm.dz} мм`;
      panelDimsHud.hidden = false;
    } else {
      panelDimsHud.hidden = true;
    }

    animateFocusPart(primary, { duration: 520, padding: 1.45, mode: "smooth" });

    const mapping = resolvePartMappingStatus(part);
    return {
      ...buildHighlightResult({
        ok: true,
        mesh: primary,
        part,
        mappingStatus: mapping.mappingStatus,
        reason: "mesh_found"
      }),
      mesh: primary
    };
  }

  function animateFocusPart(target, opts = {}) {
    if (!target) return;
    cameraAnimator.focusPart(target, opts);
  }

  function resetCamera() {
    fitToView();
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
    const size = box.getSize(new THREE.Vector3());
    sceneExtentsPreferMm = detectSceneExtentsPreferMm([size.x, size.y, size.z]);
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    camera.far = Math.max(1000, maxDim * 10);
    camera.near = Math.max(0.01, maxDim / 10000);
    camera.updateProjectionMatrix();
    syncFloorGrid(box);
    syncShadowReceiver(box);
    if (detailOnly) {
      const applied = applyPendingDetailView();
      if (!applied) {
        model.traverse((child) => {
          if (isRenderableMesh(child)) child.visible = true;
        });
        updatePickHint();
      }
      fitPartDetailView(model);
    } else {
      fitToView(model);
      updatePickHint();
    }
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
    const loadFormat = detectModelFormat(url, format);

    const prefetched = await takePrefetchedModelBuffer(url, token);
    if (prefetched) {
      if (loadFormat === "wrl" || loadFormat === "wrl_model" || loadFormat === "vrml") {
        const text = new TextDecoder().decode(prefetched);
        return loadVrmlText(text);
      }
      return loadGltfBuffer(prefetched);
    }

    const res = await fetch(fullUrl, { headers, credentials: "include" });
    if (!res.ok) throw new Error("Не вдалося завантажити 3D модель");

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
    ghostOthers(meshName) {
      if (!meshName) return;
      applyHighlight({ meshName, ghostOthers: true, isolate: false });
    },
    focusPart(target, opts) {
      animateFocusPart(target, opts);
    },
    fitToPart(part, targetHint = null) {
      const mesh = resolveMeshForPart(part, targetHint);
      if (mesh) animateFocusPart(mesh, { duration: 400, padding: 1.35 });
      else fitToView();
    },
    triggerScanPulse() {
      triggerScanPulse();
    },
    setProductionStatusOverlay(statusMap = []) {
      productionStatusByMesh.clear();
      for (const item of statusMap) {
        const key = item.meshName || item.resolvedMeshName;
        if (key && item.status) productionStatusByMesh.set(String(key), String(item.status));
      }
      applyProductionStatusTints();
    },
    getDiagnostics() {
      const meshes = listMeshes();
      return {
        hasModel: Boolean(model),
        meshCount: meshes.length,
        meshes,
        drawingMode: drawingModeEnabled,
        wireframe: wireframeEnabled,
        measureEnabled,
        sectionEnabled,
        highlightMesh: highlightMesh?.name || null,
        selectedMesh: selectedMesh?.name || null,
        productionStatusCount: productionStatusByMesh.size,
        sceneExtentsPreferMm,
        detailOnly,
        theme
      };
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
    showPartDetail(part, targetHint) {
      return queueDetailPart(part, targetHint);
    },
    showPartOnAssembly(part, targetHint) {
      return showPartOnAssemblyImpl(part, targetHint);
    },
    showPartOnAssemblyResult(part, targetHint) {
      return showPartOnAssemblyResultImpl(part, targetHint);
    },
    setCadGeometry(geometry) {
      setCadGeometry(geometry);
    },
    setSectionEnabled(enabled) {
      setSectionEnabled(enabled);
    },
    setMeasureEnabled(enabled) {
      setMeasureEnabled(enabled);
    },
    setWireframe(enabled) {
      setWireframe(enabled);
    },
    setAxesVisible(enabled) {
      setAxesVisible(enabled);
    },
    setCameraPreset(preset) {
      setCameraPreset(preset);
    },
    setDrawingMode(enabled) {
      setDrawingMode(enabled);
    },
    listMeshes() {
      return listMeshes();
    },
    setMeshVisible(meshName, visible) {
      setMeshVisible(meshName, visible);
    },
    setMeshTransparent(meshName, transparent) {
      setMeshTransparent(meshName, transparent);
    },
    resetMeshVisibility() {
      resetMeshVisibility();
    },
    resetCamera,
    fitToView,
    fitPartDetailView(object) {
      fitPartDetailView(object);
    },
    zoomIn() {
      zoomBy(0.82);
    },
    zoomOut() {
      zoomBy(1.22);
    },
    destroy() {
      if (animId) cancelAnimationFrame(animId);
      cameraAnimator.cancel();
      clearDetailMarkers();
      clearProceduralDetail();
      clearMeasure();
      if (gridHelper) {
        scene.remove(gridHelper);
        gridHelper.geometry?.dispose?.();
        gridHelper.material?.dispose?.();
        gridHelper = null;
      }
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    }
  };
}
