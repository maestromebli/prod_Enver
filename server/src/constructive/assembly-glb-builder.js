import { buildPreviewGlbFromPanels, layoutPreviewPanels } from "./project-glb-builder.js";
import { normalizePartCode } from "./parsers/assembly-export.js";

const MM = 0.001;

/** Базіс (Z вгору) → glTF (Y вгору), мм → м. */
export function bazisMmToGltf([x, y, z]) {
  return { x: x * MM, y: z * MM, z: -y * MM };
}

export function bazisDirToGltf([x, y, z]) {
  const p = bazisMmToGltf([x, y, z]);
  const len = Math.hypot(p.x, p.y, p.z);
  if (len < 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: p.x / len, y: p.y / len, z: p.z / len };
}

/** Кватерніон з ортонормованих стовпців матриці обертання (glTF Y-up). */
export function quaternionFromAxes(axisX, axisY, axisZ) {
  const m00 = axisX.x;
  const m10 = axisX.y;
  const m20 = axisX.z;
  const m01 = axisY.x;
  const m11 = axisY.y;
  const m21 = axisY.z;
  const m02 = axisZ.x;
  const m12 = axisZ.y;
  const m22 = axisZ.z;

  const trace = m00 + m11 + m22;
  let qw;
  let qx;
  let qy;
  let qz;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return [qx / len, qy / len, qz / len, qw / len];
}

function panelScaleFromAssembly(projectPanel, asmPanel) {
  const size = asmPanel.sizeMm;
  if (Array.isArray(size) && size.length >= 3) {
    const gx = bazisMmToGltf([size[0], 0, 0]);
    const gy = bazisMmToGltf([0, size[1], 0]);
    const gz = bazisMmToGltf([0, 0, size[2]]);
    return {
      x: Math.hypot(gx.x, gx.y, gx.z),
      y: Math.hypot(gy.x, gy.y, gy.z),
      z: Math.hypot(gz.x, gz.y, gz.z)
    };
  }
  return {
    x: projectPanel.lengthMm * MM,
    y: projectPanel.thicknessMm * MM,
    z: projectPanel.widthMm * MM
  };
}

/** Панелі з .project + координати збірки → позиції для GLB. */
export function layoutAssemblyPanels(projectPanels = [], assemblyExport) {
  const asmMap = new Map((assemblyExport?.panels || []).map((p) => [normalizePartCode(p.code), p]));

  const laidOut = [];
  const missing = [];

  for (const panel of projectPanels) {
    const asm = asmMap.get(normalizePartCode(panel.code));
    if (!asm) {
      missing.push(panel.code);
      continue;
    }

    const center = bazisMmToGltf(asm.centerMm);
    const axisX = bazisDirToGltf(asm.axisX);
    const axisY = bazisDirToGltf(asm.axisY);
    const axisZ = bazisDirToGltf(asm.axisZ);

    laidOut.push({
      ...panel,
      position: center,
      scale: panelScaleFromAssembly(panel, asm),
      rotation: quaternionFromAxes(axisX, axisY, axisZ)
    });
  }

  if (!laidOut.length) {
    const err = new Error("Жодна панель .project не зіставилась із координатами збірки");
    err.code = "ASSEMBLY_MISMATCH";
    throw err;
  }

  return { panels: laidOut, missing };
}

/** GLB повної збірки з .project + assembly export. */
export function buildAssemblyGlbFromProject(projectPanels, assemblyExport, options = {}) {
  const { panels, missing } = layoutAssemblyPanels(projectPanels, assemblyExport);
  const glb = buildPreviewGlbFromPanels(panels, {
    ...options,
    previewLayout: "assembly"
  });
  return { ...glb, panelCount: panels.length, missingCodes: missing };
}

/** Fallback: панелі без координат — плоска сітка. */
export function buildMixedPreviewGlb(projectPanels, assemblyExport, options = {}) {
  const { panels: assembled, missing } = layoutAssemblyPanels(projectPanels, assemblyExport);
  const flat = layoutPreviewPanels(projectPanels.filter((p) => missing.includes(p.code)));
  const all = [...assembled, ...flat];
  const glb = buildPreviewGlbFromPanels(all, {
    ...options,
    previewLayout: assembled.length ? "assembly" : "flat"
  });
  return { ...glb, panelCount: all.length, missingCodes: missing };
}
