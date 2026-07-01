/**
 * Злиття Bazis .b3d + .project + ENVER_3dscan → повний manifest для CRM і 3D.
 */

import {
  ENVER_3DSCAN_FORMAT_VERSION,
  ENVER_3DSCAN_KIND,
  extractEnver3dscanFromB3d,
  normalizePartCode,
  parseEnver3dscanJson
} from "../../../shared/production/enver-3dscan.js";
import { resolveScanPanelDimensions } from "../../../shared/production/enver-3dscan-part-layout.js";
import {
  buildPartCadGeometry,
  indexProjectOperations
} from "../../../shared/production/bazis-operation-geometry.js";
import { normalizeBazisScanCode } from "../../../shared/production/bazis-operation-code.js";
import { decodeProjectText } from "./parsers/project-text.js";
import { manifestNodesFromProjectXml } from "./parsers/manifest-text.js";
import { extractProjectPanels } from "./project-glb-builder.js";
import { parseAssemblyExportJson } from "./parsers/assembly-export.js";
import {
  extractEnverAssemblyFromB3d,
  buildAssemblyExportFromScanPanels
} from "./parsers/assembly-export.js";
import { buildEnver3dscanFromB3dDecode } from "./bazis-b3d-decoder.js";

function mergeWarnings(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function projectPartsFromText(projectText) {
  const parsed = manifestNodesFromProjectXml(projectText, "project_xml");
  return parsed.parts || [];
}

function mergeScanPanels(primary, secondary) {
  if (!secondary?.panels?.length) return primary;
  if (!primary?.panels?.length) return secondary;

  const posedByCode = new Map();
  const posedByDim = new Map();
  const usedCodes = new Set();

  for (const p of secondary.panels) {
    if (!p.centerMm || !p.axisX) continue;
    const code = normalizePartCode(p.code || p.partNo);
    if (code && !posedByCode.has(code)) posedByCode.set(code, p);
    const l = Math.round(p.lengthMm || p.sizeMm?.[0] || 0);
    const w = Math.round(p.widthMm || p.sizeMm?.[1] || 0);
    const t = Math.round(p.thicknessMm || p.sizeMm?.[2] || 18);
    for (const key of [`${l}x${w}x${t}`, `${w}x${l}x${t}`]) {
      if (!posedByDim.has(key)) posedByDim.set(key, p);
    }
  }

  function findPoseByDim(lengthMm, widthMm, thicknessMm, excludeCodes = new Set()) {
    const l = Math.round(lengthMm || 0);
    const w = Math.round(widthMm || 0);
    const t = Math.round(thicknessMm || 18);
    for (const tol of [0, 2, 5, 8]) {
      for (const [dl, dw] of [
        [l, w],
        [w, l]
      ]) {
        const exact = `${dl}x${dw}x${t}`;
        const panel = posedByDim.get(exact);
        if (panel) {
          const code = normalizePartCode(panel.code || panel.partNo);
          if (!code || !excludeCodes.has(code)) return panel;
        }
        for (const [key, panel] of posedByDim) {
          const code = normalizePartCode(panel.code || panel.partNo);
          if (code && excludeCodes.has(code)) continue;
          const [kl, kw, kt] = key.split("x").map(Number);
          if (Math.abs(kl - dl) <= tol && Math.abs(kw - dw) <= tol && Math.abs(kt - t) <= tol) {
            return panel;
          }
        }
      }
    }
    return null;
  }

  const panels = primary.panels.map((p) => {
    if (p.centerMm && p.axisX) return p;
    const code = normalizePartCode(p.code || p.partNo);
    let pose = code ? posedByCode.get(code) : null;
    if (pose) {
      usedCodes.add(code);
    } else {
      pose = findPoseByDim(p.lengthMm, p.widthMm, p.thicknessMm, usedCodes);
      if (pose) {
        const poseCode = normalizePartCode(pose.code || pose.partNo);
        if (poseCode) usedCodes.add(poseCode);
      }
    }
    if (!pose) return p;
    return {
      ...p,
      centerMm: pose.centerMm,
      sizeMm: pose.sizeMm || p.sizeMm,
      axisX: pose.axisX,
      axisY: pose.axisY,
      axisZ: pose.axisZ,
      gabMinMm: pose.gabMinMm,
      gabMaxMm: pose.gabMaxMm
    };
  });

  return { ...primary, panels };
}

/** Збірка з ENVER_3dscan / ENVER3 / sidecar JSON. */
export function resolveScanDocument({ b3dBuffer = null, scanJsonBuffer = null } = {}) {
  if (scanJsonBuffer?.length) {
    try {
      return parseEnver3dscanJson(scanJsonBuffer.toString("utf8"));
    } catch {
      /* ignore */
    }
  }
  if (b3dBuffer?.length) {
    const scan = extractEnver3dscanFromB3d(b3dBuffer);
    if (scan?.panels?.length) return scan;
    const enver3 = extractEnverAssemblyFromB3d(b3dBuffer);
    if (enver3?.panels?.length) {
      return parseEnver3dscanJson({
        kind: ENVER_3DSCAN_KIND,
        version: 1,
        source: "enver3_compat",
        exportedAt: enver3.exportedAt,
        productName: enver3.productName,
        panels: enver3.panels.map((p) => ({
          ...p,
          meshName: `panel-${p.code}`
        })),
        skipped: enver3.skipped || []
      });
    }
  }
  return null;
}

/**
 * Побудувати документ ENVER_3dscan з .project (без координат збірки — лише метадані).
 */
export function buildEnver3dscanFromProject(projectBuffer, { productName = "" } = {}) {
  if (!projectBuffer?.length) return null;
  const text = decodeProjectText(projectBuffer);
  const projectParts = projectPartsFromText(text);
  const partMetaByCode = new Map();
  for (const p of projectParts) {
    const code = normalizePartCode(p.partNo || p.partCode);
    if (code && !partMetaByCode.has(code)) partMetaByCode.set(code, p);
  }

  const panels3d = extractProjectPanels(projectBuffer);
  const { operationsByCode } = indexProjectOperations(text);

  const panels = [];
  for (const dims of panels3d) {
    const code = normalizePartCode(dims.code);
    if (!code) continue;
    const p = partMetaByCode.get(code);
    const opsForPart = [...operationsByCode.values()].filter(
      (op) => String(op.partNo) === String(code) || normalizePartCode(op.partNo) === code
    );
    const cad = buildPartCadGeometry({
      projectTexts: [text],
      part: {
        partNo: code,
        blockCode: p?.blockCode || "",
        edgeCode: p?.edgeCode || ""
      }
    });

    panels.push({
      code,
      partNo: String(p?.partNo || code),
      name: p?.partName || dims.partName || `Деталь ${code}`,
      blockCode: p?.blockCode || "",
      material: p?.material || "",
      thicknessMm: dims.thicknessMm || Number(p?.thickness) || 18,
      lengthMm: dims.lengthMm || Number(p?.length) || null,
      widthMm: dims.widthMm || Number(p?.width) || null,
      edgeCode: p?.edgeCode || "",
      edgeMask: cad?.edgeMask || null,
      holes: cad?.holes || [],
      holeCount: cad?.holeCount || 0,
      bazisOperations: opsForPart.map((o) => o.code).filter(Boolean),
      meshName: p?.blockCode ? `${p.blockCode}-${p.partNo}` : `panel-${code}`,
      colorFactor: dims.colorFactor ?? null
    });
  }

  if (!panels.length) return null;

  return parseEnver3dscanJson({
    kind: ENVER_3DSCAN_KIND,
    version: ENVER_3DSCAN_FORMAT_VERSION,
    source: "project_derived",
    exportedAt: new Date().toISOString(),
    productName,
    panels,
    meta: { derivedFrom: "project_only" }
  });
}

/**
 * Злиття .b3d + .project + ENVER_3dscan → parts, manifest, assembly GLB input.
 */
export function fuseBazisPackage({
  b3dBuffer = null,
  projectBuffer = null,
  scanJsonBuffer = null,
  productName = ""
} = {}) {
  const warnings = [];
  const stats = {
    b3dBytes: b3dBuffer?.length || 0,
    projectBytes: projectBuffer?.length || 0,
    hasB3d: Boolean(b3dBuffer?.length),
    hasProject: Boolean(projectBuffer?.length)
  };

  let scan = resolveScanDocument({ b3dBuffer, scanJsonBuffer });
  let b3dDecode = null;

  if (b3dBuffer?.length) {
    b3dDecode = buildEnver3dscanFromB3dDecode(b3dBuffer, { productName });
    if (b3dDecode.analysis) {
      stats.b3dFields = b3dDecode.analysis.importantFields;
      stats.b3dDecodedPanels = b3dDecode.analysis.stats?.decodedPanelCount || 0;
      stats.b3dPosedPanels = b3dDecode.analysis.stats?.posedPanelCount || 0;
      warnings.push(...(b3dDecode.analysis.warnings || []));
    }
  }

  const projectText = projectBuffer?.length ? decodeProjectText(projectBuffer) : "";
  const projectParts = projectText ? projectPartsFromText(projectText) : [];
  const { operationsByCode } = projectText
    ? indexProjectOperations(projectText)
    : { operationsByCode: new Map() };

  const fromProject = projectBuffer?.length
    ? buildEnver3dscanFromProject(projectBuffer, { productName })
    : null;

  if (fromProject?.panels?.length) {
    let baseScan = fromProject;
    if (scan?.panels?.length) {
      baseScan = mergeScanPanels(fromProject, scan);
      if (scan.exportedAt) baseScan.exportedAt = scan.exportedAt;
      if (scan.productName) baseScan.productName = scan.productName;
      if (scan.source && scan.source !== "project_derived") baseScan.source = scan.source;
    }
    if (b3dDecode?.scan?.panels?.length) {
      baseScan = mergeScanPanels(baseScan, b3dDecode.scan);
      if (b3dDecode.analysis?.stats?.posedPanelCount > 0) {
        warnings.push("Координати збірки доповнено з декодованого .b3d (де знайдено)");
      }
    }
    scan = baseScan;
    if (!scan.panels.some((p) => p.centerMm && p.axisX)) {
      warnings.push("ENVER_3dscan побудовано з .project — координати збірки можуть бути відсутні");
    }
  } else if (!scan?.panels?.length && b3dDecode?.scan?.panels?.length) {
    scan = b3dDecode.scan;
  } else if (scan?.panels?.length && b3dDecode?.scan?.panels?.length) {
    scan = mergeScanPanels(scan, b3dDecode.scan);
  }

  if (!scan?.panels?.length) {
    return {
      scan: null,
      parts: projectParts,
      manifestNodes: [],
      assemblyExport: null,
      warnings: mergeWarnings(warnings, [
        "Не вдалося зібрати ENVER_3dscan — додайте .project разом із .b3d (GibLab)"
      ]),
      stats
    };
  }

  const parts = [];
  const partMetaByCode = new Map();
  for (const p of projectParts) {
    const code = normalizePartCode(p.partNo || p.partCode);
    if (code && !partMetaByCode.has(code)) partMetaByCode.set(code, p);
  }

  for (const panel of scan.panels) {
    const code = normalizePartCode(panel.code);
    const dims = resolveScanPanelDimensions(panel);
    panel.lengthMm = panel.lengthMm || dims.lengthMm;
    panel.widthMm = panel.widthMm || dims.widthMm;
    panel.thicknessMm = panel.thicknessMm || dims.thicknessMm;
    if (!panel.meshName) panel.meshName = `panel-${code}`;
    const partNo = panel.partNo || code;
    const blockCode = panel.blockCode || "";
    const existing = partMetaByCode.get(code);

    const bazisOps = (panel.bazisOperations || []).map(normalizeBazisScanCode).filter(Boolean);
    if (!bazisOps.length && projectText) {
      for (const op of operationsByCode.values()) {
        if (String(op.partNo) === String(partNo) || normalizePartCode(op.partNo) === code) {
          bazisOps.push(op.code);
        }
      }
    }

    let cad = null;
    if (projectText) {
      cad = buildPartCadGeometry({
        projectTexts: [projectText],
        part: {
          partNo,
          blockCode,
          edgeCode: panel.edgeCode || existing?.edgeCode || "",
          bazisOperationCodes: bazisOps
        }
      });
    }

    if (cad && !panel.holes?.length) {
      panel.holes = cad.holes || [];
      panel.holeCount = cad.holeCount || 0;
      panel.edgeMask = panel.edgeMask || cad.edgeMask || null;
    }

    parts.push({
      blockCode: blockCode || existing?.blockCode || "",
      partNo: String(partNo),
      partName: panel.name || existing?.partName || `Деталь ${partNo}`,
      material: panel.material || existing?.material || "",
      thickness: String(panel.thicknessMm || existing?.thickness || ""),
      length: String(panel.lengthMm || existing?.length || ""),
      width: String(panel.widthMm || existing?.width || ""),
      edgeCode: panel.edgeCode || existing?.edgeCode || "",
      qty: existing?.qty || 1,
      note: existing?.note || "",
      modelMeshName: panel.meshName || `panel-${code}`,
      modelNodeId: panel.meshName || code,
      bazisOperationCodes: bazisOps,
      source: existing ? "fused" : "enver_3dscan"
    });
  }

  const manifestNodes = [];
  for (const p of parts) {
    if (p.modelMeshName) {
      manifestNodes.push({
        meshName: p.modelMeshName,
        nodeId: p.modelNodeId || p.modelMeshName,
        partNo: String(p.partNo || ""),
        blockCode: p.blockCode || "",
        source: "enver_3dscan_fusion"
      });
    }
  }

  let assemblyExport = null;
  const posedPanels = scan.panels.filter((p) => p.centerMm && p.axisX && p.axisY && p.axisZ);
  if (posedPanels.length) {
    try {
      assemblyExport = parseAssemblyExportJson({
        version: 1,
        source: scan.source || "enver_3dscan",
        exportedAt: scan.exportedAt,
        productName: scan.productName || productName,
        panels: posedPanels.map((p) => ({
          code: p.code,
          name: p.name,
          artPos: p.artPos,
          thicknessMm: p.thicknessMm,
          centerMm: p.centerMm,
          sizeMm: p.sizeMm,
          axisX: p.axisX,
          axisY: p.axisY,
          axisZ: p.axisZ
        }))
      });
      stats.assemblyPanelCount = posedPanels.length;
    } catch {
      warnings.push("Панелі ENVER_3dscan без повних координат збірки — 3D буде плоскою розкладкою");
    }
  }

  if (!assemblyExport) {
    assemblyExport = buildAssemblyExportFromScanPanels(scan, { productName });
    if (assemblyExport?.panels?.length) {
      stats.assemblyPanelCount = assemblyExport.panels.length;
      warnings.push("Координати збірки з .b3d — осі DirX доповнено автоматично, де не знайдено");
    }
  }

  stats.scanPanelCount = scan.panels.length;
  stats.projectPartCount = projectParts.length;
  stats.fusedPartCount = parts.length;

  return {
    scan,
    parts,
    manifestNodes,
    assemblyExport,
    warnings,
    stats
  };
}
