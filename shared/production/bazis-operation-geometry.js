/**
 * Геометрія операцій Bazis з program XML у .project.
 * Координати отворів у мм панелі (dx × dy × dz).
 */

import { normalizeBazisScanCode, partNoFromBazisOperationCode } from "./bazis-operation-code.js";
import { edgeSideMask, operationFaceIndexFromCode } from "./part-detail-display.js";

function pickXmlAttr(attrs, names) {
  for (const n of names) {
    const escaped = String(n).replace(/\./g, "\\.");
    const am = attrs.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*["']([^"']*)["']`, "i"));
    if (am) return am[1].trim();
  }
  return "";
}

export function decodeBazisProgramAttr(program) {
  return String(program || "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/");
}

function readAttrFloat(attrs, name) {
  const raw = pickXmlAttr(attrs, [name]);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function boreDiameterFromName(name) {
  const m = String(name || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseDepthValue(dp, panelDz) {
  const raw = String(dp ?? "").trim();
  if (!raw) return null;
  if (/through/i.test(raw)) return Number(panelDz) + 2;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Розбір program XML: панель і отвори. */
export function parseBazisProgramGeometry(programXml) {
  const decoded = decodeBazisProgramAttr(programXml);
  const dx = Number(decoded.match(/\bdx\s*=\s*["']([\d.]+)/i)?.[1]) || null;
  const dy = Number(decoded.match(/\bdy\s*=\s*["']([\d.]+)/i)?.[1]) || null;
  const dz = Number(decoded.match(/\bdz\s*=\s*["']([\d.]+)/i)?.[1]) || null;
  const holes = [];

  const tagRe = /<(bf|bb|bt|bl|br)\s([^>]*?)\/?>/gi;
  let m;
  while ((m = tagRe.exec(decoded))) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] || "";
    const name = pickXmlAttr(attrs, ["name"]);
    const diameterMm = boreDiameterFromName(name);
    const depthMm = parseDepthValue(pickXmlAttr(attrs, ["dp"]), dz);

    if (kind === "bf" || kind === "bb" || kind === "bt") {
      const xMm = readAttrFloat(attrs, "x");
      const yMm = readAttrFloat(attrs, "y");
      if (xMm == null || yMm == null) continue;
      holes.push({
        kind,
        face: kind === "bb" ? "bottom" : kind === "bt" ? "top" : "panel",
        xMm,
        yMm,
        diameterMm,
        depthMm
      });
      continue;
    }

    const yMm = readAttrFloat(attrs, "y");
    const zMm = readAttrFloat(attrs, "z");
    if (yMm == null || zMm == null) continue;
    holes.push({
      kind,
      face: kind === "bl" ? "left" : "right",
      yMm,
      zMm,
      diameterMm,
      depthMm
    });
  }

  return {
    panelMm: { dx, dy, dz },
    holes
  };
}

function normalizePartNoKey(partNo) {
  const s = String(partNo || "").trim();
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n)) return String(n);
  return s.replace(/^0+/, "") || s;
}

function parseOperationRef(ref) {
  const m = String(ref || "").match(/@operation#(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Усі операції XNC/EL з .project. */
export function indexProjectOperations(projectText) {
  const operationsByCode = new Map();
  const operationTypeById = new Map();
  const re = /<operation([^>]*)>/gi;
  let m;
  while ((m = re.exec(projectText))) {
    const attrs = m[1] || "";
    const id = Number(pickXmlAttr(attrs, ["id"])) || null;
    const typeId = pickXmlAttr(attrs, ["typeId"]).toUpperCase();
    const code = normalizeBazisScanCode(pickXmlAttr(attrs, ["code"]));
    const side = Number(pickXmlAttr(attrs, ["side"])) || null;
    const program = pickXmlAttr(attrs, ["program"]);

    if (id) operationTypeById.set(id, typeId);

    if (!code || !program) continue;
    const geometry = parseBazisProgramGeometry(program);
    operationsByCode.set(code, {
      code,
      id,
      typeId,
      side,
      partNo: partNoFromBazisOperationCode(code),
      ...geometry
    });
  }
  return { operationsByCode, operationTypeById };
}

function partAttrsFromProject(projectText, partNo) {
  const key = normalizePartNoKey(partNo);
  const re = /<part([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(projectText))) {
    const attrs = m[1] || "";
    const code =
      pickXmlAttr(attrs, ["code", "part.code", "part.position"]) ||
      pickXmlAttr(attrs, ["id"]) ||
      "";
    if (normalizePartNoKey(code) !== key) continue;
    return {
      dl: pickXmlAttr(attrs, ["dl", "Length", "L"]),
      dw: pickXmlAttr(attrs, ["dw", "Width", "W"]),
      elt: pickXmlAttr(attrs, ["elt"]),
      elb: pickXmlAttr(attrs, ["elb"]),
      ell: pickXmlAttr(attrs, ["ell"]),
      elr: pickXmlAttr(attrs, ["elr"])
    };
  }
  return null;
}

/** Маска кромки [top, right, bottom, left] з посилань elt/elb/ell/elr. */
export function edgeMaskFromPartRefs(partAttrs, operationTypeById) {
  if (!partAttrs) return null;
  const sides = [
    ["elt", 0],
    ["elr", 1],
    ["elb", 2],
    ["ell", 3]
  ];
  const mask = [false, false, false, false];
  let any = false;
  for (const [attr, idx] of sides) {
    const opId = parseOperationRef(partAttrs[attr]);
    if (!opId) continue;
    const typeId = operationTypeById.get(opId) || "";
    if (typeId === "EL") {
      mask[idx] = true;
      any = true;
    }
  }
  return any ? mask : null;
}

function mergePanelMm(target, source) {
  if (!source) return target;
  return {
    dx: target?.dx ?? source.dx,
    dy: target?.dy ?? source.dy,
    dz: target?.dz ?? source.dz
  };
}

/**
 * CAD-геометрія деталі з текстів .project.
 * @param {{ projectTexts?: string[], part?: object }} input
 */
export function buildPartCadGeometry(input = { projectTexts: [], part: null }) {
  const { projectTexts = [], part } = input;
  if (!part) return null;
  const partNo = normalizePartNoKey(part.partNo || part.part_no);
  if (!partNo) return null;

  const codes = (part.bazisOperationCodes || part.bazis_operation_codes || [])
    .map(normalizeBazisScanCode)
    .filter(Boolean);

  let panelMm = {
    dx: Number(part.length) || null,
    dy: Number(part.width) || null,
    dz: Number(part.thickness) || null
  };
  const holes = [];
  let edgeMask = null;

  for (const text of projectTexts) {
    const { operationsByCode, operationTypeById } = indexProjectOperations(text);
    const partAttrs = partAttrsFromProject(text, partNo);
    edgeMask = edgeMask || edgeMaskFromPartRefs(partAttrs, operationTypeById);

    if (partAttrs?.dl) panelMm.dx = Number(partAttrs.dl) || panelMm.dx;
    if (partAttrs?.dw) panelMm.dy = Number(partAttrs.dw) || panelMm.dy;

    const opCodes =
      codes.length > 0
        ? codes
        : [...operationsByCode.values()]
            .filter((op) => normalizePartNoKey(op.partNo) === partNo)
            .map((op) => op.code);

    for (const code of opCodes) {
      const op = operationsByCode.get(code);
      if (!op) continue;
      panelMm = mergePanelMm(panelMm, op.panelMm);
      for (const hole of op.holes) {
        holes.push({
          ...hole,
          operationCode: code,
          operationFace: operationFaceIndexFromCode(code)
        });
      }
    }
  }

  const fallbackMask = edgeSideMask(part.edgeCode || part.edge_code);
  const resolvedEdgeMask = edgeMask || fallbackMask;

  if (!holes.length && !resolvedEdgeMask.some(Boolean) && !panelMm.dx) {
    return null;
  }

  return {
    panelMm,
    edgeMask: resolvedEdgeMask,
    edgeMaskSource: edgeMask ? "project" : part.edgeCode || part.edge_code ? "edge_code" : "none",
    holes,
    holeCount: holes.length
  };
}
