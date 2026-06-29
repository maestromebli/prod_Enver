/**
 * CAD-утиліти для 3D viewer: мапінг мм панелі → локальні координати mesh.
 */

const EPS = 1e-6;

export function resolvePanelMm(cadGeometry, part = {}) {
  const panel = cadGeometry?.panelMm || {};
  return {
    dx: Number(panel.dx) || Number(part.length) || null,
    dy: Number(panel.dy) || Number(part.width) || null,
    dz: Number(panel.dz) || Number(part.thickness) || null
  };
}

/** Визначає осі панелі в локальному просторі mesh (товщина = найкоротша вісь). */
export function analyzePanelAxes(box) {
  const min = box.min;
  const max = box.max;
  const size = {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z
  };
  const axes = [
    { key: "x", len: size.x },
    { key: "y", len: size.y },
    { key: "z", len: size.z }
  ].sort((a, b) => a.len - b.len);

  const thin = axes[0].key;
  const wide = axes[2].key;
  const mid = axes[1].key;

  return { thin, wide, mid, size, min, max };
}

function setAxisValue(vec, axis, value) {
  vec[axis] = value;
}

/**
 * Перетворює отвір Bazis (мм) у THREE.Vector3 у локальних координатах mesh.
 * @param {{ min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } }} box
 */
export function mapCadHoleToLocal(box, hole, panelMm) {
  const { thin, wide, mid, size, min, max } = analyzePanelAxes(box);
  const dx = Number(panelMm.dx) || size[wide];
  const dy = Number(panelMm.dy) || size[mid];
  const dz = Number(panelMm.dz) || size[thin];

  const pos = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const inset = Math.max(dz * 0.35, 0.0015);

  if (hole.face === "panel" || hole.kind === "bf" || hole.kind === "bt") {
    const u = (Number(hole.xMm) || 0) / Math.max(dx, EPS);
    const v = (Number(hole.yMm) || 0) / Math.max(dy, EPS);
    setAxisValue(pos, wide, min[wide] + u * size[wide]);
    setAxisValue(pos, mid, min[mid] + v * size[mid]);
    setAxisValue(pos, thin, max[thin] - inset);
  } else if (hole.face === "bottom" || hole.kind === "bb") {
    const u = (Number(hole.xMm) || 0) / Math.max(dx, EPS);
    const v = (Number(hole.yMm) || 0) / Math.max(dy, EPS);
    setAxisValue(pos, wide, min[wide] + u * size[wide]);
    setAxisValue(pos, mid, min[mid] + v * size[mid]);
    setAxisValue(pos, thin, min[thin] + inset);
  } else if (hole.face === "left" || hole.kind === "bl") {
    const v = (Number(hole.yMm) || 0) / Math.max(dy, EPS);
    const depth = (Number(hole.zMm) || 0) / Math.max(dz, EPS);
    setAxisValue(pos, mid, min[mid] + v * size[mid]);
    setAxisValue(pos, thin, min[thin] + depth * size[thin]);
    setAxisValue(pos, wide, min[wide] + inset);
  } else if (hole.face === "right" || hole.kind === "br") {
    const v = (Number(hole.yMm) || 0) / Math.max(dy, EPS);
    const depth = (Number(hole.zMm) || 0) / Math.max(dz, EPS);
    setAxisValue(pos, mid, min[mid] + v * size[mid]);
    setAxisValue(pos, thin, min[thin] + depth * size[thin]);
    setAxisValue(pos, wide, max[wide] - inset);
  }

  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    thinAxis: thin,
    panelScaleMm: Math.max(dx, dy, dz)
  };
}

/** Відстань між двома точками у мм за масштабом панелі. */
export function measureDistanceMm(a, b, box, panelMm) {
  const { size } = analyzePanelAxes(box);
  const dx = Number(panelMm.dx) || size.x;
  const dy = Number(panelMm.dy) || size.y;
  const dz = Number(panelMm.dz) || size.z;
  const scaleX = dx / Math.max(size.x, EPS);
  const scaleY = dy / Math.max(size.y, EPS);
  const scaleZ = dz / Math.max(size.z, EPS);

  const dxw = (b.x - a.x) * scaleX;
  const dyw = (b.y - a.y) * scaleY;
  const dzw = (b.z - a.z) * scaleZ;
  return Math.sqrt(dxw * dxw + dyw * dyw + dzw * dzw);
}

export function formatMeasureMm(mm) {
  if (!Number.isFinite(mm)) return "—";
  if (mm >= 100) return `${mm.toFixed(1)} мм`;
  if (mm >= 10) return `${mm.toFixed(1)} мм`;
  return `${mm.toFixed(2)} мм`;
}
