import {
  decodeProjectText,
  pickXmlAttr,
  buildOperationThicknessMap
} from "./parsers/project-text.js";

const MM = 0.001;
const PREVIEW_GAP_M = 0.04;
const PREVIEW_ROW_WIDTH_M = 4.5;

/** Панелі з .project для 3D-превʼю (розміри в мм). */
export function extractProjectPanels(projectBuffer) {
  const text = decodeProjectText(projectBuffer);
  const thicknessByCode = buildOperationThicknessMap(text);
  const panels = [];
  const seen = new Set();

  const re = /<part([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1] || "";
    const code =
      pickXmlAttr(attrs, ["code", "part.code", "part.position"]) ||
      pickXmlAttr(attrs, ["Number", "Num", "PartNo", "Id"]) ||
      "";
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const partName = pickXmlAttr(attrs, ["name", "Name", "Title"]) || `Деталь ${code}`;
    const colorFactor = parsePartColorFactor(attrs);
    const lengthMm = Number(pickXmlAttr(attrs, ["dl", "Length", "L"])) || 0;
    const widthMm = Number(pickXmlAttr(attrs, ["dw", "Width", "W"])) || 0;
    const thicknessMm =
      Number(pickXmlAttr(attrs, ["dz", "Thickness", "Thick", "t"])) ||
      Number(thicknessByCode.get(code) || thicknessByCode.get(String(Number(code)))) ||
      18;

    if (lengthMm <= 0 || widthMm <= 0) continue;

    panels.push({
      code: String(code),
      partName,
      colorFactor,
      lengthMm,
      widthMm,
      thicknessMm: thicknessMm > 0 ? thicknessMm : 18
    });
  }

  return panels;
}

/** Розкладка панелей у сітку для огляду (позиції в метрах). */
export function layoutPreviewPanels(panels = []) {
  let x = 0;
  let z = 0;
  let rowDepth = 0;

  return panels.map((p) => {
    const sx = p.lengthMm * MM;
    const sy = p.thicknessMm * MM;
    const sz = p.widthMm * MM;

    if (x > 0 && x + sx > PREVIEW_ROW_WIDTH_M) {
      x = 0;
      z += rowDepth + PREVIEW_GAP_M;
      rowDepth = 0;
    }

    const position = {
      x: x + sx / 2,
      y: sy / 2,
      z: z + sz / 2
    };

    x += sx + PREVIEW_GAP_M;
    rowDepth = Math.max(rowDepth, sz);

    return {
      ...p,
      scale: { x: sx, y: sy, z: sz },
      position
    };
  });
}

function panelBaseColorFactor(code, index) {
  let hash = (index + 1) * 131;
  for (const ch of String(code)) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  const s = 0.3;
  const l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m, 1];
}

function parsePartColorFactor(attrs) {
  const raw =
    pickXmlAttr(attrs, ["color", "Color", "colour", "rgb", "RGB"]) ||
    pickXmlAttr(attrs, ["decor", "Decor", "material_decor", "MaterialDecor"]);
  if (!raw) return null;

  const hex = raw.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }

  const parts = raw
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (parts.length >= 3) {
    const scale = parts.some((n) => n > 1) ? 255 : 1;
    return [parts[0] / scale, parts[1] / scale, parts[2] / scale, 1];
  }

  return null;
}

function unitBoxGeometry() {
  const p = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5
  ];
  const indices = [
    0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4, 0, 4, 7, 7, 3, 0, 1, 5, 6, 6, 2, 1, 3, 2, 6, 6, 7, 3, 0, 1,
    5, 5, 4, 0
  ];
  return { positions: new Float32Array(p), indices: new Uint16Array(indices) };
}

function align4(n) {
  return (n + 3) & ~3;
}

function vec3Bounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
    }
  }
  return { min, max };
}

/** GLB з довільної геометрії (контур деталі, одна mesh). */
export function buildGlbFromMeshGeometry({
  name = "panel",
  positions,
  indices,
  colorFactor = null,
  translation = [0, 0, 0],
  generator = "enver-part-detail-contour"
} = {}) {
  if (!positions?.length || !indices?.length) {
    const err = new Error("Порожня геометрія для GLB");
    err.code = "EMPTY_MESH";
    throw err;
  }

  const posBytes = positions.byteLength;
  const idxBytes = indices.byteLength;
  const bin = Buffer.alloc(align4(posBytes + idxBytes));
  Buffer.from(positions.buffer, positions.byteOffset, posBytes).copy(bin, 0);
  Buffer.from(indices.buffer, indices.byteOffset, idxBytes).copy(bin, posBytes);

  const bounds = vec3Bounds(positions);
  const vertCount = positions.length / 3;

  const gltf = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [
      {
        name,
        mesh: 0,
        translation: [translation[0], translation[1], translation[2]]
      }
    ],
    meshes: [
      {
        name,
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }]
      }
    ],
    materials: [
      {
        name,
        pbrMetallicRoughness: {
          baseColorFactor: colorFactor || panelBaseColorFactor(name, 0),
          metallicFactor: 0.05,
          roughnessFactor: 0.82
        }
      }
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: vertCount,
        type: "VEC3",
        min: bounds.min,
        max: bounds.max
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR"
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = align4(json.length);
  const jsonChunk = Buffer.alloc(jsonPad);
  json.copy(jsonChunk);

  const binPad = align4(bin.length);
  const binChunk = Buffer.alloc(binPad);
  bin.copy(binChunk);

  const total = 12 + 8 + jsonPad + 8 + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o);
  o += 4;
  out.writeUInt32LE(2, o);
  o += 4;
  out.writeUInt32LE(total, o);
  o += 4;
  out.writeUInt32LE(jsonPad, o);
  o += 4;
  out.writeUInt32LE(0x4e4f534a, o);
  o += 4;
  jsonChunk.copy(out, o);
  o += jsonPad;
  out.writeUInt32LE(binPad, o);
  o += 4;
  out.writeUInt32LE(0x004e4942, o);
  o += 4;
  binChunk.copy(out, o);

  return { buffer: out, panelCount: 1 };
}

function gltfNodeFromPanel(panel, meshIndex) {
  const node = {
    name: panel.code,
    mesh: meshIndex,
    translation: [panel.position.x, panel.position.y, panel.position.z],
    scale: [panel.scale.x, panel.scale.y, panel.scale.z]
  };
  const rot = panel.rotation;
  if (rot && rot.length === 4) {
    node.rotation = rot;
  }
  return node;
}

/** GLB з іменованими вузлами (mesh name = code деталі) для підсвітки при скані. */
export function buildPreviewGlbFromPanels(
  panels = [],
  { productName = "", previewLayout = "flat" } = {}
) {
  if (!panels.length) {
    const err = new Error("Немає панелей для 3D-превʼю");
    err.code = "NO_PANELS";
    throw err;
  }

  const { positions, indices } = unitBoxGeometry();
  const posBytes = positions.byteLength;
  const idxBytes = indices.byteLength;
  const bin = Buffer.alloc(align4(posBytes + idxBytes));
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(indices.buffer).copy(bin, posBytes);

  // Окремий mesh на кожну панель — інакше Three.js переміщує спільний mesh лише до останнього вузла.
  const nodes = panels.map((panel, i) => gltfNodeFromPanel(panel, i));

  const panelPrimitive = (materialIndex) => ({
    attributes: { POSITION: 0 },
    indices: 1,
    material: materialIndex,
    mode: 4
  });

  const materials = panels.map((panel, i) => ({
    name: `panel-${panel.code}`,
    pbrMetallicRoughness: {
      baseColorFactor: panel.colorFactor || panelBaseColorFactor(panel.code, i),
      metallicFactor: 0.05,
      roughnessFactor: 0.82
    }
  }));

  const gltf = {
    asset: {
      version: "2.0",
      generator:
        previewLayout === "assembly"
          ? "enver-project-preview-assembly"
          : previewLayout === "part_detail"
            ? "enver-part-detail-box"
            : "enver-project-preview-flat"
    },
    scene: 0,
    scenes: [{ name: productName || "preview", nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: panels.map((panel, i) => ({
      name: `panel-${panel.code}`,
      primitives: [panelPrimitive(i)]
    })),
    materials,
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5]
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 36,
        type: "SCALAR"
      }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = align4(json.length);
  const jsonChunk = Buffer.alloc(jsonPad);
  json.copy(jsonChunk);

  const binPad = align4(bin.length);
  const binChunk = Buffer.alloc(binPad);
  bin.copy(binChunk);

  const total = 12 + 8 + jsonPad + 8 + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o);
  o += 4;
  out.writeUInt32LE(2, o);
  o += 4;
  out.writeUInt32LE(total, o);
  o += 4;
  out.writeUInt32LE(jsonPad, o);
  o += 4;
  out.writeUInt32LE(0x4e4f534a, o);
  o += 4;
  jsonChunk.copy(out, o);
  o += jsonPad;
  out.writeUInt32LE(binPad, o);
  o += 4;
  out.writeUInt32LE(0x004e4942, o);
  o += 4;
  binChunk.copy(out, o);

  return { buffer: out, panelCount: panels.length, panels };
}

/** GLB-превʼю з .project (застарілий шлях — для тестів). */
export function buildPreviewGlbFromProject(projectBuffer, options = {}) {
  const panels = layoutPreviewPanels(extractProjectPanels(projectBuffer));
  return buildPreviewGlbFromPanels(panels, options);
}

const GLB_MAGIC = 0x46546c67;

/** Старий формат: усі вузли на один mesh — Three.js показує лише останню панель. */
/** `assembly` | `flat` | null — з asset.generator автопревʼю GLB. */
export function readPreviewLayoutFromGlb(buffer) {
  if (!buffer?.length || buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    return null;
  }
  try {
    const jsonLen = buffer.readUInt32LE(12);
    const json = buffer.toString("utf8", 20, 20 + jsonLen).replace(/\0+$/, "");
    const gltf = JSON.parse(json);
    const generator = gltf.asset?.generator || "";
    if (generator === "enver-project-preview-assembly") return "assembly";
    if (generator.startsWith("enver-project-preview")) return "flat";
    return null;
  } catch {
    return null;
  }
}

export function isLegacySharedMeshPreviewGlb(buffer) {
  if (!buffer?.length || buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    return false;
  }
  try {
    const jsonLen = buffer.readUInt32LE(12);
    const json = buffer.toString("utf8", 20, 20 + jsonLen).replace(/\0+$/, "");
    const gltf = JSON.parse(json);
    const generator = gltf.asset?.generator || "";
    if (!generator.startsWith("enver-project-preview")) return false;
    const nodeMeshes = (gltf.nodes || []).filter((n) => n.mesh != null).length;
    const meshCount = gltf.meshes?.length || 0;
    return nodeMeshes > 1 && meshCount === 1;
  } catch {
    return false;
  }
}
