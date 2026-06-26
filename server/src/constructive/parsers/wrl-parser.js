/** Мінімальний розбір VRML (.wrl) з Базіс — 3D-збірка без деталей закупівлі. */

const DEF_RE = /\bDEF\s+([A-Za-z0-9_-]+)/g;
const VRML_MARKER = /#VRML/i;

function collectManifestNodes(text) {
  const manifestNodes = [];
  const seen = new Set();
  let match;
  while ((match = DEF_RE.exec(text)) !== null) {
    const name = match[1];
    if (!name || name.startsWith("TLine3D") || seen.has(name)) continue;
    seen.add(name);
    manifestNodes.push({ meshName: name, nodeId: name });
  }
  return manifestNodes;
}

export function parseWrlBuffer(buffer, originalName = "") {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  const isVrml = VRML_MARKER.test(text);
  const manifestNodes = collectManifestNodes(text);
  const warnings = [];

  if (!isVrml) {
    warnings.push(`Файл ${originalName}: не схожий на VRML — перегляд 3D може не спрацювати`);
  }
  if (!manifestNodes.length) {
    warnings.push(
      `Файл ${originalName}: VRML без іменованих вузлів — лише перегляд збірки, без мапінгу деталей`
    );
  }

  return {
    materials: [],
    hardware: [],
    parts: [],
    blocks: [],
    manifestNodes,
    warnings,
    extractionQuality: isVrml ? "partial" : "poor",
    modelReadiness: { has3dSource: true, needsGlbExport: false, source: "wrl" }
  };
}
