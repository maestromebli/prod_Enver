/**
 * 2D-контур панелі Bazis → трикутники + екструзія по товщині (Y-up, метри).
 */

const EPS = 1e-9;

function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = cross2(cx - ax, cy - ay, px - ax, py - ay);
  const s2 = cross2(ax - bx, ay - by, px - bx, py - by);
  const s3 = cross2(bx - cx, by - cy, px - cx, py - cy);
  const hasNeg = s1 < -EPS || s2 < -EPS || s3 < -EPS;
  const hasPos = s1 > EPS || s2 > EPS || s3 > EPS;
  return !(hasNeg && hasPos);
}

/** Earcut-подібна триангуляція простого полігону (мм → локальні XZ). */
export function triangulatePolygon2d(points) {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const verts = points.map((p, i) => ({ x: p[0], y: p[1], i }));
  if (signedArea(verts.map((v) => [v.x, v.y])) < 0) verts.reverse();

  const indices = verts.map((_, i) => i);
  const out = [];
  let guard = 0;

  while (indices.length > 3 && guard < n * n) {
    guard += 1;
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      const a = verts[i0];
      const b = verts[i1];
      const c = verts[i2];
      const cross = cross2(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
      if (cross <= EPS) continue;

      let inside = false;
      for (const j of indices) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = verts[j];
        if (pointInTriangle(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;

      out.push(a.i, b.i, c.i);
      indices.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }

  if (indices.length === 3) {
    out.push(verts[indices[0]].i, verts[indices[1]].i, verts[indices[2]].i);
  }
  return out;
}

/** Центрує контур і повертає точки в метрах (площина XZ). */
export function normalizeContourToXZ(contourMm, mm = 0.001) {
  if (!Array.isArray(contourMm) || contourMm.length < 3) return null;

  const pts = contourMm
    .map((p) => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [x, y];
    })
    .filter(Boolean);
  if (pts.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const xz = pts.map(([x, y]) => [(x - cx) * mm, (y - cy) * mm]);
  return { points: xz, widthM: (maxX - minX) * mm, depthM: (maxY - minY) * mm };
}

/** Екструзія контуру по Y (товщина вгору). */
export function extrudeContourMesh(contourMm, thicknessMm, { mm = 0.001 } = {}) {
  const norm = normalizeContourToXZ(contourMm, mm);
  if (!norm) return null;

  const height = Math.max(Number(thicknessMm) || 18, 1) * mm;
  const tris = triangulatePolygon2d(norm.points);
  if (tris.length < 3) return null;

  const n = norm.points.length;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const [x, z] = norm.points[i];
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = z;
    positions[n * 3 + i * 3] = x;
    positions[n * 3 + i * 3 + 1] = height;
    positions[n * 3 + i * 3 + 2] = z;
  }

  const indices = [];
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(tris[i + 2], tris[i + 1], tris[i]);
  }
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(tris[i] + n, tris[i + 1] + n, tris[i + 2] + n);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i;
    const b = j;
    const c = j + n;
    const d = i + n;
    indices.push(a, b, c, a, c, d);
  }

  return {
    positions,
    indices: new Uint16Array(indices),
    height,
    widthM: norm.widthM,
    depthM: norm.depthM
  };
}
