import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { apiUrl } from "./api.js";

/** Three.js viewer з підсвіткою деталі. */
export function createPartViewer(container, { onReady, onError } = {}) {
  if (!container) return { destroy() {} };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.01,
    1000
  );
  camera.position.set(2, 2, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, Math.max(container.clientHeight, 200));
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  let model = null;
  let highlightMesh = null;
  let ghostMode = false;
  let animId = null;

  const meshMap = new Map();

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
      if (child.isMesh) {
        meshMap.set(child.name, child);
        child.userData.originalMaterial = child.material;
      }
    });
  }

  function applyHighlight({ meshName, nodeId, isolate = false, ghost = true }) {
    if (!model) return;
    ghostMode = ghost;
    const key = meshName || nodeId;
    highlightMesh = key ? meshMap.get(key) || null : null;

    model.traverse((child) => {
      if (!child.isMesh) return;
      const isTarget =
        child === highlightMesh ||
        (meshName && child.name === meshName) ||
        (nodeId && child.name === nodeId);

      if (isTarget) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xffaa00,
          emissive: 0x442200,
          metalness: 0.2,
          roughness: 0.4
        });
        child.visible = true;
      } else if (isolate) {
        child.visible = false;
      } else if (ghost) {
        child.visible = true;
        child.material = new THREE.MeshStandardMaterial({
          color: 0x888888,
          transparent: true,
          opacity: 0.15,
          depthWrite: false
        });
      } else {
        child.material = child.userData.originalMaterial || child.material;
        child.visible = true;
      }
    });
  }

  function resetCamera() {
    camera.position.set(2, 2, 3);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  async function loadModel(url, token) {
    const loader = new GLTFLoader();
    const fullUrl = url.startsWith("http") ? url : apiUrl(url);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(fullUrl, { headers });
    if (!res.ok) throw new Error("Не вдалося завантажити 3D модель");
    const buffer = await res.arrayBuffer();
    return new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        "",
        (gltf) => {
          if (model) scene.remove(model);
          model = gltf.scene;
          scene.add(model);
          indexMeshes(model);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 0.1);
          camera.position.copy(center).add(new THREE.Vector3(maxDim, maxDim * 0.8, maxDim * 1.2));
          controls.target.copy(center);
          controls.update();
          onReady?.();
          resolve(model);
        },
        reject
      );
    });
  }

  return {
    loadModel(url, token) {
      return loadModel(url, token);
    },
    highlightPart(opts) {
      applyHighlight(opts || {});
    },
    showAll() {
      if (!model) return;
      model.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
          child.material = child.userData.originalMaterial || child.material;
        }
      });
    },
    isolatePart(meshName) {
      applyHighlight({ meshName, isolate: true, ghost: false });
    },
    resetCamera,
    destroy() {
      if (animId) cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      container.innerHTML = "";
    }
  };
}
