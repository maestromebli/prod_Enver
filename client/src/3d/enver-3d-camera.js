import * as THREE from "three";

/**
 * Плавна анімація камери до mesh або bounds.
 * @param {{ camera: THREE.Camera, controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls, onTick?: () => void }} ctx
 */
export function createCameraAnimator({ camera, controls, onTick }) {
  /** @type {number | null} */
  let rafId = null;

  function cancel() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /**
   * @param {THREE.Object3D | THREE.Box3 | null} target
   * @param {{ duration?: number, padding?: number, mode?: 'smooth' | 'instant' }} [opts]
   */
  function focusPart(target, { duration = 500, padding = 1.4, mode = "smooth" } = {}) {
    cancel();
    if (!target || !camera || !controls) return;

    const box =
      target instanceof THREE.Box3
        ? target.clone()
        : (() => {
            target.updateWorldMatrix?.(true, true);
            return new THREE.Box3().setFromObject(target);
          })();

    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const faceSpan = Math.max(size.x, size.y, size.z, 0.05);
    const dist = faceSpan * padding;

    const endPos = center.clone().add(new THREE.Vector3(dist * 0.85, dist * 0.65, dist * 1.0));
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endTarget = center.clone();

    controls.minDistance = Math.max(0.02, faceSpan * 0.12);
    controls.maxDistance = Math.max(8, faceSpan * 14);

    if (mode === "instant" || duration <= 0) {
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      controls.update();
      onTick?.();
      return;
    }

    const t0 = performance.now();
    const ease = (x) => 1 - (1 - x) ** 3;

    const step = (now) => {
      const raw = Math.min(1, (now - t0) / duration);
      const k = ease(raw);
      camera.position.lerpVectors(startPos, endPos, k);
      controls.target.lerpVectors(startTarget, endTarget, k);
      controls.update();
      onTick?.();
      if (raw < 1) rafId = requestAnimationFrame(step);
      else rafId = null;
    };
    rafId = requestAnimationFrame(step);
  }

  return { focusPart, cancel };
}

/** Додаткові пресети камери (back). */
export const EXTENDED_CAMERA_PRESETS = {
  back: (center, maxDim) => center.clone().add(new THREE.Vector3(0, maxDim * 0.15, -maxDim * 1.6))
};
