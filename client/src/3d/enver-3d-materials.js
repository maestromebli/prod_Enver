import * as THREE from "three";
import { PRODUCTION_STATUS_COLORS } from "./enver-3d-types.js";

/** Матеріал з tint за виробничим статусом (не перекриває highlight). */
export function tintMaterialForStatus(baseMaterial, status, { useLambert = false } = {}) {
  const colorHex = PRODUCTION_STATUS_COLORS[status];
  if (!colorHex || !baseMaterial) return baseMaterial;

  const baseColor = baseMaterial.color?.clone?.() ?? new THREE.Color(0x9aaec3);
  const tint = new THREE.Color(colorHex);
  baseColor.lerp(tint, 0.38);

  if (useLambert) {
    return new THREE.MeshLambertMaterial({
      color: baseColor,
      side: THREE.FrontSide,
      transparent: Boolean(baseMaterial.transparent),
      opacity: baseMaterial.opacity ?? 1
    });
  }
  return new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: baseMaterial.metalness ?? 0.1,
    roughness: baseMaterial.roughness ?? 0.55,
    transparent: Boolean(baseMaterial.transparent),
    opacity: baseMaterial.opacity ?? 1,
    side: baseMaterial.side ?? THREE.FrontSide
  });
}

/** Емісивна пульсація для scan/highlight. */
export function pulseEmissiveIntensity(elapsedSec, { cycles = 3, duration = 1.2 } = {}) {
  if (elapsedSec >= duration) return 0;
  const t = elapsedSec / duration;
  return 0.12 + 0.28 * Math.sin(t * Math.PI * cycles);
}
